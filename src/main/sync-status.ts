import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { SyncStatus, SyncStatusState } from '@shared/api'
import { loadToken } from './safe-storage'

const FETCH_TIMEOUT_MS = 8000

function isGitRepo(repoPath: string): boolean {
  return existsSync(join(repoPath, '.git'))
}

/**
 * GitHub git-over-HTTPS rejects `Authorization: Bearer <token>` with
 * "remote: invalid credentials". Use HTTP Basic with x-access-token (the
 * documented form for OAuth tokens). Mirrors push.ts authArgs.
 */
function authArgs(token: string | null): string[] {
  if (!token) return []
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`]
}

function gitOutput(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function fetchWithTimeout(repoPath: string, token: string | null): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      [...authArgs(token), '-C', repoPath, 'fetch', '--quiet', 'origin'],
      { cwd: repoPath },
    )
    let stderr = ''
    let settled = false
    const settle = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve({ ok, stderr })
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* noop */
      }
      settle(false)
    }, FETCH_TIMEOUT_MS)
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString()
    })
    child.on('exit', (code) => {
      clearTimeout(t)
      settle(code === 0)
    })
    child.on('error', () => {
      clearTimeout(t)
      settle(false)
    })
  })
}

function currentBranch(repoPath: string): string | null {
  const r = gitOutput(['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
  if (!r.ok) return null
  const name = r.stdout.trim()
  return name === 'HEAD' || name === '' ? null : name
}

function hasUpstream(repoPath: string, branch: string): boolean {
  const r = gitOutput(
    ['-C', repoPath, 'rev-parse', '--verify', '--quiet', `origin/${branch}`],
    repoPath,
  )
  return r.ok
}

function countCommits(repoPath: string, range: string): number {
  const r = gitOutput(['-C', repoPath, 'rev-list', '--count', range], repoPath)
  if (!r.ok) return 0
  const n = parseInt(r.stdout.trim(), 10)
  return Number.isFinite(n) ? n : 0
}

function deriveState(behind: number, ahead: number): SyncStatusState {
  if (behind === 0 && ahead === 0) return 'in-sync'
  if (behind > 0 && ahead === 0) return 'behind'
  if (behind === 0 && ahead > 0) return 'ahead'
  return 'diverged'
}

const NO_REMOTE_STATUS: SyncStatus = {
  state: 'no-remote',
  behind: 0,
  ahead: 0,
  fetchedAt: null,
}

export type SyncStatusOpts = {
  repoPath: string | null
  userDataDir: string
  /** when true, run `git fetch` to update origin refs before counting */
  doFetch: boolean
}

export async function getSyncStatus(opts: SyncStatusOpts): Promise<SyncStatus> {
  const { repoPath, userDataDir, doFetch } = opts
  if (!repoPath || !isGitRepo(repoPath)) {
    return NO_REMOTE_STATUS
  }
  const branch = currentBranch(repoPath)
  if (!branch) {
    return { state: 'unknown', behind: 0, ahead: 0, fetchedAt: null }
  }

  let fetchedAt: number | null = null
  let offline = false
  if (doFetch) {
    const token = loadToken(userDataDir)
    const f = await fetchWithTimeout(repoPath, token)
    if (f.ok) {
      fetchedAt = Date.now()
    } else {
      offline = true
    }
  }

  if (!hasUpstream(repoPath, branch)) {
    return {
      state: 'unknown',
      behind: 0,
      ahead: 0,
      fetchedAt,
      errorKey: 'sync.error.noUpstream',
    }
  }

  const behind = countCommits(repoPath, `${branch}..origin/${branch}`)
  const ahead = countCommits(repoPath, `origin/${branch}..${branch}`)
  const state: SyncStatusState = offline ? 'offline' : deriveState(behind, ahead)
  return {
    state,
    behind,
    ahead,
    fetchedAt,
    ...(offline ? { errorKey: 'sync.error.fetchFailed' } : {}),
  }
}
