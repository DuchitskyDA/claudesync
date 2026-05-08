import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  cpSync,
} from 'node:fs'
import { join } from 'node:path'
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

function syncFile(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function syncDirMirror(src: string, dst: string): void {
  if (!existsSync(src)) {
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    return
  }
  // Remove dst entries that don't exist in src (mirror semantics)
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst)) {
      if (!existsSync(join(src, entry))) {
        rmSync(join(dst, entry), { recursive: true, force: true })
      }
    }
  }
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
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

function authArgs(token: string): string[] {
  return ['-c', `http.extraheader=Authorization: Bearer ${token}`]
}

function failResult(error: string): RunResult {
  return { ok: false, exitCode: -1, error }
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

    // 3. Pull-rebase
    opts.emitStep({ step: 'pull', status: 'running' })
    const rebase = await runCommand(
      'git',
      [...authArgs(token), '-C', repoPath, 'pull', '--rebase', '--autostash'],
      { cwd: repoPath, onLine: opts.emit },
    )
    if (rebase.exitCode !== 0) {
      await runCommand('git', ['-C', repoPath, 'rebase', '--abort'], {
        cwd: repoPath,
        onLine: opts.emit,
      }).catch(() => {})
      opts.emitStep({ step: 'pull', status: 'failed', message: 'conflict' })
      return failResult(
        `Conflict during rebase. Resolve manually in ${repoPath}, then push again.`,
      )
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
