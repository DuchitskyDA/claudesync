import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { ConflictState, ConflictFile, ConflictFileStatus, ConflictFileContent, ConflictResolveChoice, ConflictResolveResult, RunResult } from '@shared/api'

export const STAGE_BASE = 1
export const STAGE_REMOTE = 2  // git's --ours during rebase (= upstream)
export const STAGE_MINE = 3    // git's --theirs during rebase (= local commits)

function isRebaseInProgress(repoPath: string): boolean {
  return (
    existsSync(join(repoPath, '.git', 'rebase-merge')) ||
    existsSync(join(repoPath, '.git', 'rebase-apply'))
  )
}

function gitOutput(args: string[], cwd: string): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

function gitTry(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function listUnmergedFiles(repoPath: string): string[] {
  const out = gitOutput(['diff', '--name-only', '--diff-filter=U', '-z'], repoPath)
  if (!out) return []
  return out.split('\0').filter(Boolean)
}

export function isFileBinary(repoPath: string, path: string): boolean {
  const fullPath = join(repoPath, path)
  if (!existsSync(fullPath)) {
    const r = gitTry(['diff', '--numstat', '--cached', '--', path], repoPath)
    if (r.stdout.startsWith('-\t-\t')) return true
    return false
  }
  try {
    const fd = readFileSync(fullPath)
    const sample = fd.subarray(0, 8192)
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return true
    }
    return false
  } catch {
    return false
  }
}

function fileStatus(_repoPath: string, _path: string): ConflictFileStatus {
  // Files in the unmerged-list are 'unresolved' by definition. Local UI tracks
  // mine/remote/manual labels — those aren't deducible from git state alone.
  return 'unresolved'
}

export function getStageContent(
  repoPath: string,
  path: string,
  stage: number,
): ConflictFileContent {
  const binary = isFileBinary(repoPath, path)
  if (binary) return { text: null, binary: true }

  const r = spawnSync('git', ['show', `:${stage}:${path}`], {
    cwd: repoPath,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    // Stage may be absent (e.g., add/add conflict has no :1: base) — return empty.
    return { text: '', binary: false }
  }
  return { text: r.stdout ?? '', binary: false }
}

export function getConflictState(repoPath: string): ConflictState {
  if (!isRebaseInProgress(repoPath)) {
    return { inProgress: false, files: [] }
  }
  const paths = listUnmergedFiles(repoPath)
  const files: ConflictFile[] = paths.map((p) => ({
    path: p,
    status: fileStatus(repoPath, p),
    binary: isFileBinary(repoPath, p),
  }))
  return { inProgress: true, files }
}

const CONFLICT_MARKER_RE = /^(<{7}|={7}|>{7})/m

function fileHasConflictMarkers(repoPath: string, path: string): boolean {
  const fullPath = join(repoPath, path)
  if (!existsSync(fullPath)) return false
  try {
    const content = readFileSync(fullPath, 'utf8')
    return CONFLICT_MARKER_RE.test(content)
  } catch {
    return false
  }
}

export function resolveFile(
  repoPath: string,
  path: string,
  choice: ConflictResolveChoice,
): ConflictResolveResult {
  if (choice === 'mine' || choice === 'remote') {
    const flag = choice === 'mine' ? '--theirs' : '--ours'
    const co = gitTry(['checkout', flag, '--', path], repoPath)
    if (!co.ok) {
      return {
        ok: false,
        error: {
          key: 'conflict.error.checkoutFailed',
          params: { reason: co.stderr.trim() },
          fallback: co.stderr.trim(),
        },
      }
    }
  } else {
    // manual: file must already be edited free of conflict markers
    if (fileHasConflictMarkers(repoPath, path)) {
      return { ok: false, error: { key: 'conflict.error.markersRemain' } }
    }
  }
  const add = gitTry(['add', '--', path], repoPath)
  if (!add.ok) {
    return {
      ok: false,
      error: {
        key: 'conflict.error.addFailed',
        params: { reason: add.stderr.trim() },
        fallback: add.stderr.trim(),
      },
    }
  }
  return { ok: true }
}

export function continueRebase(repoPath: string): RunResult {
  // core.editor=true skips opening an editor for the commit message
  // during `rebase --continue` (would block in headless main process).
  const r = spawnSync(
    'git',
    ['-c', 'core.editor=true', 'rebase', '--continue'],
    { cwd: repoPath, encoding: 'utf8' },
  )
  if (r.status === 0) {
    return { ok: true, exitCode: 0 }
  }
  const stderr = (r.stderr ?? '').trim()
  return {
    ok: false,
    exitCode: r.status ?? -1,
    error: {
      key: 'conflict.error.continueFailed',
      params: { reason: stderr },
      fallback: stderr,
    },
  }
}

export function abortRebase(repoPath: string): void {
  // Best-effort. Errors silenced — "no rebase in progress" is expected when
  // called from recovery paths.
  spawnSync('git', ['rebase', '--abort'], { cwd: repoPath, encoding: 'utf8' })
}
