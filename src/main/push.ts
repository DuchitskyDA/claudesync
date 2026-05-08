import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  cpSync,
} from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import type { LogLine, RunResult, StepStatus, PushStep, RepoStatus } from '@shared/api'
import { runCommand, withRunLock } from './runner'
import { readConfig } from './config'
import { loadToken } from './safe-storage'

export type InstallMode = 'symlink' | 'copy'

export function detectInstallMode(rulesTarget: string, _repoPath: string): InstallMode {
  const probe = join(rulesTarget, 'CLAUDE.md')
  if (!existsSync(probe)) return 'copy'
  try {
    const stat = lstatSync(probe)
    if (stat.isSymbolicLink()) return 'symlink'
  } catch {
    // ignore
  }
  return 'copy'
}

/**
 * Returns true if src and dst resolve to the same filesystem entry.
 * Handles symlinks/junctions (common on Windows when install.ps1 uses Junction
 * for directories and falls back to copy for files — mixed mode).
 */
function isSamePath(src: string, dst: string): boolean {
  try {
    const realSrc = realpathSync(src)
    const realDst = existsSync(dst) ? realpathSync(dst) : resolvePath(dst)
    return realSrc === realDst
  } catch {
    return false
  }
}

/**
 * Names we never want to mirror into the repo:
 * - `.backup.<timestamp>` artifacts left by install.ps1
 * - common dev/cache junk (.DS_Store, Thumbs.db)
 */
const IGNORED_NAME = /\.backup\.\d|^\.DS_Store$|^Thumbs\.db$/i

function isIgnored(name: string): boolean {
  return IGNORED_NAME.test(name)
}

function syncFile(src: string, dst: string): void {
  if (!existsSync(src)) return
  if (isSamePath(src, dst)) return // already pointing at same file (junction/symlink)
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function syncDirMirror(src: string, dst: string): void {
  if (!existsSync(src)) {
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    return
  }
  // If src and dst resolve to the same dir (junction case) — content is already there, skip.
  if (isSamePath(src, dst)) return

  // Remove dst entries that don't exist in src OR that are ignored garbage
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst)) {
      if (isIgnored(entry) || !existsSync(join(src, entry))) {
        rmSync(join(dst, entry), { recursive: true, force: true })
      }
    }
  }
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (isIgnored(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    if (isSamePath(s, d)) continue
    const stat = statSync(s)
    if (stat.isDirectory()) {
      syncDirMirror(s, d)
    } else {
      cpSync(s, d)
    }
  }
}

function syncProjectsMemoryOnly(src: string, dst: string): void {
  if (!existsSync(src)) return
  for (const projectDir of readdirSync(src)) {
    const projectMemorySrc = join(src, projectDir, 'memory')
    const projectMemoryDst = join(dst, projectDir, 'memory')
    if (existsSync(projectMemorySrc)) {
      syncDirMirror(projectMemorySrc, projectMemoryDst)
    }
  }
}

export function exportRulesToRepo(rulesTarget: string, repoPath: string): void {
  const globalDir = join(repoPath, 'global')
  mkdirSync(globalDir, { recursive: true })

  // file mirror
  syncFile(join(rulesTarget, 'CLAUDE.md'), join(globalDir, 'CLAUDE.md'))
  syncFile(join(rulesTarget, 'settings.json'), join(globalDir, 'settings.json'))

  // dir mirror
  syncDirMirror(join(rulesTarget, 'commands'), join(globalDir, 'commands'))
  syncDirMirror(join(rulesTarget, 'skills'), join(globalDir, 'skills'))

  // projects — only memory subdirs (mirror within memory/, leave rest alone)
  syncProjectsMemoryOnly(join(rulesTarget, 'projects'), join(globalDir, 'projects'))
}

export function stripSecretsInRepo(repoPath: string): void {
  const settingsPath = join(repoPath, 'global', 'settings.json')
  if (!existsSync(settingsPath)) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
  } catch {
    throw new Error('Invalid JSON in global/settings.json — fix it before push')
  }
  if ('env' in parsed) {
    delete parsed.env
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2), 'utf8')
  }
}

/**
 * GitHub git-over-HTTPS rejects `Authorization: Bearer <token>` with
 * "remote: invalid credentials" even though the same token works for the REST API.
 * Use HTTP Basic with x-access-token (the documented form for OAuth tokens).
 */
function authArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`]
}

function failResult(error: string): RunResult {
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

function pullErrorMessage(kind: PullErrorKind, repoPath: string, stderr: string): string {
  const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' | ')
  switch (kind) {
    case 'network':
      return `Network error talking to GitHub (TLS/connection). Check VPN/proxy and click Push to retry.${tail ? ` — ${tail}` : ''}`
    case 'auth':
      return `GitHub auth rejected. Sign out and sign in again, then retry.${tail ? ` — ${tail}` : ''}`
    case 'conflict':
      return `Merge conflict during rebase. Resolve manually in ${repoPath}, then click Push again.`
    default:
      return `git pull --rebase failed${tail ? `: ${tail}` : ''}. See log above.`
  }
}

export type RunPushOpts = {
  configPath: string
  userDataDir: string
  includeSecrets: boolean
  commitMessage: string
  emit: (line: LogLine) => void
  emitStep: (e: { step: PushStep; status: StepStatus; message?: string }) => void
}

export async function runPush(opts: RunPushOpts): Promise<RunResult> {
  const cfg = readConfig(opts.configPath)
  if (!cfg.repoUrl || !cfg.repoPath || !cfg.rulesTarget) {
    return failResult('Sync not configured')
  }
  const token = loadToken(opts.userDataDir)
  if (!token) return failResult('Not signed in to GitHub')

  const repoPath = cfg.repoPath
  const rulesTarget = cfg.rulesTarget

  return withRunLock(async () => {
    // 1. Export (only in copy mode; symlinks already reflect changes)
    opts.emitStep({ step: 'export', status: 'running' })
    if (detectInstallMode(rulesTarget, repoPath) === 'copy') {
      try {
        exportRulesToRepo(rulesTarget, repoPath)
      } catch (e) {
        opts.emitStep({ step: 'export', status: 'failed', message: (e as Error).message })
        return failResult((e as Error).message)
      }
    }
    if (!opts.includeSecrets) {
      try {
        stripSecretsInRepo(repoPath)
      } catch (e) {
        opts.emitStep({ step: 'export', status: 'failed', message: (e as Error).message })
        return failResult((e as Error).message)
      }
    }
    opts.emitStep({ step: 'export', status: 'done' })

    // 2. Check if anything to push
    const status = await runCommand('git', ['-C', repoPath, 'status', '--porcelain'], {
      cwd: repoPath,
      onLine: opts.emit,
    })
    if (status.exitCode !== 0) return failResult('git status failed')
    if (status.stdout.trim() === '') {
      return { ok: true, exitCode: 0, error: 'Nothing to push — local config matches repo' }
    }

    // 3. Pull-rebase (with one auto-retry on transient network errors)
    opts.emitStep({ step: 'pull', status: 'running' })
    const pullArgs = [...authArgs(token), '-C', repoPath, 'pull', '--rebase', '--autostash']
    let rebase = await runCommand('git', pullArgs, { cwd: repoPath, onLine: opts.emit })
    if (rebase.exitCode !== 0) {
      const kind = classifyPullError(rebase.stderr)
      // Make sure we never leave a half-applied rebase behind. Errors are silenced —
      // "no rebase in progress" is expected when fetch failed before rebase started.
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
          await runCommand('git', ['-C', repoPath, 'rebase', '--abort'], {
            cwd: repoPath,
            onLine: () => {},
          }).catch(() => {})
          opts.emitStep({ step: 'pull', status: 'failed', message: kind2 })
          return failResult(pullErrorMessage(kind2, repoPath, rebase.stderr))
        }
      } else {
        opts.emitStep({ step: 'pull', status: 'failed', message: kind })
        return failResult(pullErrorMessage(kind, repoPath, rebase.stderr))
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
      return failResult('commit failed')
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
      return failResult(`push failed (exit ${push.exitCode})`)
    }
    opts.emitStep({ step: 'push', status: 'done' })

    return { ok: true, exitCode: 0 }
  }).catch((e: Error) => failResult(e.message))
}

export async function getRepoStatus(repoPath: string): Promise<RepoStatus> {
  const r = await runCommand('git', ['-C', repoPath, 'status', '--porcelain'], {
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
