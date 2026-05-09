import type { LogLine, RunResult, StepStatus, PushStep, RepoStatus, LocalizedMessage } from '@shared/api'
import { runCommand, withRunLock } from './runner'
import { readConfig } from './config'
import { loadToken } from './safe-storage'
import {
  detectClaudeInstallMode,
  exportClaude,
  stripSecretsInClaudeRepo,
} from './sync/claude'
import { exportCursorProjects } from './sync/cursor'

// Re-exports kept for backwards-compat with existing IPC handlers and tests.
export { detectClaudeInstallMode as detectInstallMode } from './sync/claude'
export { exportClaude as exportRulesToRepo } from './sync/claude'
export { stripSecretsInClaudeRepo as stripSecretsInRepo } from './sync/claude'
export type InstallMode = 'symlink' | 'copy'

/**
 * GitHub git-over-HTTPS rejects `Authorization: Bearer <token>` with
 * "remote: invalid credentials" even though the same token works for the REST API.
 * Use HTTP Basic with x-access-token (the documented form for OAuth tokens).
 */
function authArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`]
}

function failResult(error: LocalizedMessage): RunResult {
  return { ok: false, exitCode: -1, error }
}

export type PullErrorKind = 'network' | 'auth' | 'conflict' | 'other'

export function classifyPullError(stderr: string): PullErrorKind {
  const s = stderr.toLowerCase()
  if (
    /tls|ssl|unexpected eof|could not resolve host|connection (reset|refused|timed out)|network is unreachable|operation timed out|proxy|the requested url returned error: 5\d\d/.test(
      s,
    )
  ) {
    return 'network'
  }
  if (
    /authentication failed|401|403|invalid username or password|bad credentials|terminal prompts disabled/.test(
      s,
    )
  ) {
    return 'auth'
  }
  if (/conflict|merge|cannot pull with rebase|automatic merge failed|needs merge/.test(s)) {
    return 'conflict'
  }
  return 'other'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pullErrorLocalized(kind: PullErrorKind, repoPath: string, stderr: string): LocalizedMessage {
  const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' | ')
  const tailParam = tail ? ` — ${tail}` : ''
  switch (kind) {
    case 'network':
      return { key: 'push.error.network', params: { tail: tailParam } }
    case 'auth':
      return { key: 'push.error.auth', params: { tail: tailParam } }
    case 'conflict':
      return { key: 'push.error.conflict', params: { repoPath } }
    default:
      return { key: 'push.error.pullOther', params: { tail: tail ? `: ${tail}` : '' } }
  }
}

export type RunPushOpts = {
  configPath: string
  userDataDir: string
  includeSecrets: boolean
  commitMessage: string
  emit: (line: LogLine) => void
  emitStep: (e: { step: PushStep; status: StepStatus; message?: LocalizedMessage }) => void
}

export async function runPush(opts: RunPushOpts): Promise<RunResult> {
  const cfg = readConfig(opts.configPath)
  if (!cfg.repoUrl || !cfg.repoPath) {
    return failResult({ key: 'push.error.notConfigured' })
  }
  const claudeOk = cfg.claude.enabled && !!cfg.claude.path
  const cursorOk = cfg.cursor.enabled && cfg.cursor.projects.length > 0
  if (!claudeOk && !cursorOk) {
    return failResult({ key: 'push.error.nothingEnabled' })
  }
  const token = loadToken(opts.userDataDir)
  if (!token) return failResult({ key: 'push.error.notSignedIn' })

  const repoPath = cfg.repoPath

  return withRunLock(async () => {
    // 1. Export (only in copy mode; symlinks already reflect changes)
    opts.emitStep({ step: 'export', status: 'running' })
    if (claudeOk) {
      const claudePath = cfg.claude.path as string
      if (detectClaudeInstallMode(claudePath) === 'copy') {
        try {
          exportClaude(claudePath, repoPath)
        } catch (e) {
          opts.emitStep({ step: 'export', status: 'failed', message: { key: 'push.error.claudeExport', fallback: (e as Error).message } })
          return failResult({ key: 'push.error.claudeExport', fallback: (e as Error).message })
        }
      }
      if (!opts.includeSecrets) {
        try {
          stripSecretsInClaudeRepo(repoPath)
        } catch (e) {
          opts.emitStep({ step: 'export', status: 'failed', message: { key: 'push.error.invalidJson', fallback: (e as Error).message } })
          return failResult({ key: 'push.error.invalidJson', fallback: (e as Error).message })
        }
      }
    }
    if (cursorOk) {
      try {
        exportCursorProjects(cfg.cursor.projects, repoPath, opts.emit)
      } catch (e) {
        opts.emitStep({ step: 'export', status: 'failed', message: { key: 'push.error.cursorExport', fallback: (e as Error).message } })
        return failResult({ key: 'push.error.cursorExport', fallback: (e as Error).message })
      }
    }
    opts.emitStep({ step: 'export', status: 'done' })

    // 2. Check if anything to push
    const status = await runCommand('git', ['-C', repoPath, 'status', '--porcelain'], {
      cwd: repoPath,
      onLine: opts.emit,
    })
    if (status.exitCode !== 0) return failResult({ key: 'push.error.gitStatusFailed' })
    if (status.stdout.trim() === '') {
      return { ok: true, exitCode: 0, error: { key: 'push.info.nothingToPush' } }
    }

    // 3. Pull-rebase (with one auto-retry on transient network errors)
    opts.emitStep({ step: 'pull', status: 'running' })
    const pullArgs = [...authArgs(token), '-C', repoPath, 'pull', '--rebase', '--autostash']
    let rebase = await runCommand('git', pullArgs, { cwd: repoPath, onLine: opts.emit })
    if (rebase.exitCode !== 0) {
      const kind = classifyPullError(rebase.stderr)

      if (kind === 'conflict') {
        // Leave rebase paused for the resolver UI. Do NOT --abort.
        const message: LocalizedMessage = { key: 'push.error.conflict', params: { repoPath } }
        opts.emitStep({ step: 'pull', status: 'failed', message })
        return { ok: false, exitCode: rebase.exitCode, error: message, kind: 'conflict' as const }
      }

      // Non-conflict failure: clean up half-applied rebase before returning.
      // Errors are silenced — "no rebase in progress" is expected when fetch failed before rebase started.
      await runCommand('git', ['-C', repoPath, 'rebase', '--abort'], {
        cwd: repoPath,
        onLine: () => {},
      }).catch(() => {})

      if (kind === 'network') {
        opts.emit({
          time: new Date().toTimeString().slice(0, 8),
          text: 'Network glitch — retrying pull in 2s…',
          level: 'info',
        })
        await delay(2000)
        rebase = await runCommand('git', pullArgs, { cwd: repoPath, onLine: opts.emit })
        if (rebase.exitCode !== 0) {
          const kind2 = classifyPullError(rebase.stderr)
          if (kind2 === 'conflict') {
            // Conflict on retry — leave rebase paused for the resolver UI.
            const message: LocalizedMessage = { key: 'push.error.conflict', params: { repoPath } }
            opts.emitStep({ step: 'pull', status: 'failed', message })
            return { ok: false, exitCode: rebase.exitCode, error: message, kind: 'conflict' as const }
          }
          await runCommand('git', ['-C', repoPath, 'rebase', '--abort'], {
            cwd: repoPath,
            onLine: () => {},
          }).catch(() => {})
          const msg2 = pullErrorLocalized(kind2, repoPath, rebase.stderr)
          opts.emitStep({ step: 'pull', status: 'failed', message: msg2 })
          return failResult(msg2)
        }
      } else {
        const msg = pullErrorLocalized(kind, repoPath, rebase.stderr)
        opts.emitStep({ step: 'pull', status: 'failed', message: msg })
        return failResult(msg)
      }
    }
    opts.emitStep({ step: 'pull', status: 'done' })

    // 4. Commit
    opts.emitStep({ step: 'commit', status: 'running' })
    await runCommand('git', ['-C', repoPath, 'add', '-A'], {
      cwd: repoPath,
      onLine: opts.emit,
    })
    const commit = await runCommand(
      'git',
      [
        '-C',
        repoPath,
        '-c',
        'user.email=claudesync@noreply',
        '-c',
        'user.name=claudesync',
        'commit',
        '-m',
        opts.commitMessage,
      ],
      { cwd: repoPath, onLine: opts.emit },
    )
    if (commit.exitCode !== 0) {
      opts.emitStep({ step: 'commit', status: 'failed' })
      return failResult({ key: 'push.error.commitFailed' })
    }
    opts.emitStep({ step: 'commit', status: 'done' })

    // 5. Push
    opts.emitStep({ step: 'push', status: 'running' })
    const push = await runCommand(
      'git',
      [...authArgs(token), '-C', repoPath, 'push', 'origin', 'main'],
      { cwd: repoPath, onLine: opts.emit },
    )
    if (push.exitCode !== 0) {
      opts.emitStep({ step: 'push', status: 'failed' })
      return failResult({ key: 'push.error.pushExit', params: { code: push.exitCode } })
    }
    opts.emitStep({ step: 'push', status: 'done' })

    return { ok: true, exitCode: 0 }
  }).catch((e: Error) => failResult({ key: 'push.error.pullOther', fallback: e.message }))
}

export async function getRepoStatus(repoPath: string): Promise<RepoStatus> {
  // -uall expands untracked directories to their individual files so the
  // Push modal lists each file the user is about to commit (and the count
  // matches the sync chip's localChanges).
  const r = await runCommand('git', ['-C', repoPath, 'status', '--porcelain', '-uall'], {
    cwd: repoPath,
    onLine: () => {},
  })
  if (r.exitCode !== 0) return { changedFiles: [], clean: true }
  const lines = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[A-Z?! ]{1,2}\s+/, ''))
  return { changedFiles: lines, clean: lines.length === 0 }
}
