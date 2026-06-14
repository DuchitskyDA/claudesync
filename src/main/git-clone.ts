import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LogLine, CloneResult } from '@shared/api'
import { runCommand } from './runner'

export type RepoRef = { owner: string; name: string }

/** Parse owner/name from a GitHub repo URL (https or ssh, with/without .git). */
export function parseRepoUrl(url: string): RepoRef | null {
  const t = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  const m = t.match(/(?:github\.com[/:])([^/]+)\/([^/]+)$/i)
  return m ? { owner: m[1]!, name: m[2]! } : null
}

/** Canonical form for comparing two repo URLs — ignores scheme, .git suffix,
 *  case, and trailing slash. */
export function normalizeRepoUrl(url: string): string {
  const r = parseRepoUrl(url)
  return r
    ? `github.com/${r.owner.toLowerCase()}/${r.name.toLowerCase()}`
    : url.trim().toLowerCase().replace(/\.git$/i, '').replace(/\/+$/, '')
}

/** Scan each dir's immediate children for a git repo whose origin matches
 *  `url`. Returns absolute paths of matching clones. Best-effort: unreadable
 *  dirs and non-git children are skipped. */
export async function findExistingClones(url: string, searchDirs: string[]): Promise<string[]> {
  const target = normalizeRepoUrl(url)
  const found: string[] = []
  const seen = new Set<string>()
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const name of entries) {
      const child = join(dir, name)
      if (seen.has(child)) continue
      seen.add(child)
      try { if (!statSync(child).isDirectory()) continue } catch { continue }
      if (!existsSync(join(child, '.git'))) continue
      const origin = await gitOriginUrl(child)
      if (origin && normalizeRepoUrl(origin) === target) found.push(child)
    }
  }
  return found
}

async function gitOriginUrl(repoDir: string): Promise<string | null> {
  try {
    const r = await runCommand('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], {
      cwd: repoDir,
      onLine: () => {},
      timeoutMs: 10_000,
    })
    return r.exitCode === 0 ? (r.stdout.trim() || null) : null
  } catch {
    return null
  }
}

function nowHHMMSS(): string {
  const d = new Date()
  const p = (n: number) => `${n}`.padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** GitHub git-over-HTTPS needs Basic auth with x-access-token (Bearer is
 *  rejected). Empty for anonymous / non-GitHub remotes. */
function authArgs(token: string | null): string[] {
  if (!token) return []
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`]
}

/** Clone `url` into `targetPath`, streaming git output to `onLine`. Retried
 *  (network step). Caller is responsible for validating the target first. */
export async function cloneRepo(opts: {
  url: string
  targetPath: string
  token: string | null
  onLine: (l: LogLine) => void
}): Promise<CloneResult> {
  const { url, targetPath, token, onLine } = opts
  mkdirSync(dirname(targetPath), { recursive: true })
  onLine({ time: nowHHMMSS(), text: `$ git clone ${url} ${targetPath}`, level: 'info' })
  let last = { exitCode: -1 }
  for (let i = 0; i < 3; i++) {
    last = await runCommand('git', [...authArgs(token), 'clone', url, targetPath], {
      cwd: dirname(targetPath),
      onLine,
      timeoutMs: 120_000,
    })
    if (last.exitCode === 0) break
    if (i < 2) {
      onLine({ time: nowHHMMSS(), text: `clone failed (exit ${last.exitCode}) — retry ${i + 2}/3…`, level: 'info' })
      await sleep(1000 * (i + 1))
    }
  }
  return last.exitCode === 0
    ? { ok: true, repoPath: targetPath }
    : { ok: false, error: { key: 'clone.error.failed', params: { code: last.exitCode }, fallback: `git clone failed (exit ${last.exitCode})` } }
}
