// src/main/sync/engine/git-ops.ts
import { spawn } from 'node:child_process'

export type LsTreeEntry = {
  mode: '100644' | '100755'
  sha: string
  repoPath: string
  size: number
}

/**
 * Default env we inject into every git invocation:
 *   GIT_TERMINAL_PROMPT=0  — fail fast on auth prompts instead of hanging
 *   GIT_ASKPASS=           — disable any external askpass helper (e.g. macOS Keychain GUI)
 *   GCM_INTERACTIVE=Never  — disable Windows Git Credential Manager interactive UI
 */
const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GCM_INTERACTIVE: 'Never',
}

function runGit(
  cwd: string,
  args: string[],
  opts: { stdin?: Buffer; env?: Record<string, string> } = {},
): Promise<{ exitCode: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      env: { ...process.env, ...NON_INTERACTIVE_ENV, ...(opts.env ?? {}) } as NodeJS.ProcessEnv,
      shell: false,
    })
    const out: Buffer[] = []
    let err = ''
    proc.stdout.on('data', (b: Buffer) => out.push(b))
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (s: string) => { err += s })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      resolve({ exitCode: code ?? 1, stdout: Buffer.concat(out), stderr: err })
    })
    if (opts.stdin) {
      proc.stdin.end(opts.stdin)
    } else {
      proc.stdin.end()
    }
  })
}

export async function lsTree(repoPath: string, ref: string, prefix: string): Promise<LsTreeEntry[]> {
  const r = await runGit(repoPath, ['ls-tree', '-r', '-l', '-z', ref, '--', prefix])
  if (r.exitCode !== 0) {
    // unknown ref or empty tree at prefix
    if (/Not a valid object name|exists on disk, but not in/.test(r.stderr)) return []
    return []
  }
  const text = r.stdout.toString('utf8')
  if (text === '') return []
  const out: LsTreeEntry[] = []
  for (const line of text.split('\0')) {
    if (!line) continue
    // format: "<mode> <type> <sha> <size>\t<path>"
    const tabIdx = line.indexOf('\t')
    if (tabIdx < 0) continue
    const meta = line.slice(0, tabIdx).split(/\s+/).filter(Boolean)
    const repoPath_ = line.slice(tabIdx + 1)
    if (meta[1] !== 'blob') continue
    const mode = meta[0] === '100755' ? '100755' : '100644'
    const sha = meta[2] ?? ''
    const size = parseInt(meta[3] ?? '0', 10)
    out.push({ mode, sha, repoPath: repoPath_, size })
  }
  return out
}

export async function catFileBlob(repoPath: string, sha: string): Promise<Buffer> {
  const r = await runGit(repoPath, ['cat-file', 'blob', sha])
  if (r.exitCode !== 0) throw new Error(`git cat-file ${sha} failed: ${r.stderr}`)
  return r.stdout
}

export async function hashObjectWrite(repoPath: string, content: Buffer): Promise<string> {
  const r = await runGit(repoPath, ['hash-object', '-w', '--stdin'], { stdin: content })
  if (r.exitCode !== 0) throw new Error(`git hash-object failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/** Internal — used by index-builder etc. */
export const _internal = { runGit }

export async function readTreeIntoIndex(repoPath: string, ref: string, indexFile: string): Promise<void> {
  const r = await runGit(repoPath, ['read-tree', ref], { env: { GIT_INDEX_FILE: indexFile } })
  if (r.exitCode !== 0) throw new Error(`git read-tree ${ref} failed: ${r.stderr}`)
}

export async function readTreeMergeAggressive(
  repoPath: string,
  base: string,
  ours: string,
  theirs: string,
  indexFile: string,
): Promise<void> {
  const r = await runGit(
    repoPath,
    ['read-tree', '-m', '--aggressive', base, ours, theirs],
    { env: { GIT_INDEX_FILE: indexFile } },
  )
  if (r.exitCode !== 0) throw new Error(`git read-tree -m --aggressive failed: ${r.stderr}`)
}

export async function updateIndexAdd(
  repoPath: string,
  indexFile: string,
  mode: '100644' | '100755',
  sha: string,
  path: string,
): Promise<void> {
  const r = await runGit(
    repoPath,
    ['update-index', '--add', '--cacheinfo', `${mode},${sha},${path}`],
    { env: { GIT_INDEX_FILE: indexFile } },
  )
  if (r.exitCode !== 0) throw new Error(`git update-index --add ${path} failed: ${r.stderr}`)
}

export async function updateIndexRemove(
  repoPath: string,
  indexFile: string,
  path: string,
): Promise<void> {
  const r = await runGit(
    repoPath,
    ['update-index', '--force-remove', path],
    { env: { GIT_INDEX_FILE: indexFile } },
  )
  if (r.exitCode !== 0) throw new Error(`git update-index --force-remove ${path} failed: ${r.stderr}`)
}

export async function writeTree(repoPath: string, indexFile: string): Promise<string> {
  const r = await runGit(repoPath, ['write-tree'], { env: { GIT_INDEX_FILE: indexFile } })
  if (r.exitCode !== 0) throw new Error(`git write-tree failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

export async function commitTree(
  repoPath: string,
  tree: string,
  parents: string[],
  message: string,
): Promise<string> {
  const args = ['commit-tree', tree]
  for (const p of parents) args.push('-p', p)
  args.push('-m', message)
  const r = await runGit(repoPath, args, {
    env: { GIT_AUTHOR_NAME: 'claudesync', GIT_AUTHOR_EMAIL: 'claudesync@noreply', GIT_COMMITTER_NAME: 'claudesync', GIT_COMMITTER_EMAIL: 'claudesync@noreply' },
  })
  if (r.exitCode !== 0) throw new Error(`git commit-tree failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

export async function updateRef(repoPath: string, ref: string, sha: string): Promise<void> {
  const r = await runGit(repoPath, ['update-ref', ref, sha])
  if (r.exitCode !== 0) throw new Error(`git update-ref ${ref} failed: ${r.stderr}`)
}

export async function revParse(repoPath: string, ref: string): Promise<string> {
  const r = await runGit(repoPath, ['rev-parse', ref])
  if (r.exitCode !== 0) throw new Error(`git rev-parse ${ref} failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/** Reset WT to match HEAD using index — no remote network, no rebase, just plumbing.
 *  We restrict `git clean` to the directories we manage (`claude/` and
 *  `cursor/`) so unrelated worktree-internal paths (e.g. linked worktrees
 *  under `.claude/worktrees/`, IDE state, user-added top-level files) are
 *  never touched. The user's sync repo is dedicated and these are the only
 *  prefixes the Engine ever writes into. */
export async function syncWtToHead(repoPath: string): Promise<void> {
  const r1 = await runGit(repoPath, ['read-tree', 'HEAD'])
  if (r1.exitCode !== 0) throw new Error(`git read-tree HEAD failed: ${r1.stderr}`)
  const r2 = await runGit(repoPath, ['checkout-index', '-a', '-f'])
  if (r2.exitCode !== 0) throw new Error(`git checkout-index -af failed: ${r2.stderr}`)
  // Remove WT files NOT in index, but ONLY within paths we manage.
  // -- claude/ cursor/ scopes the clean to those subtrees; if either doesn't
  // exist git clean will just skip it (no error).
  const r3 = await runGit(repoPath, ['clean', '-fd', '--', 'claude/', 'cursor/'])
  if (r3.exitCode !== 0) throw new Error(`git clean failed: ${r3.stderr}`)
}

export type RemoteErrorKind = 'network' | 'auth' | 'non-ff' | 'other'

export function classifyRemoteError(stderr: string): RemoteErrorKind {
  const s = stderr.toLowerCase()
  if (/non-fast-forward|fetch first|updates were rejected/.test(s)) return 'non-ff'
  if (
    /tls|ssl|unexpected eof|could not resolve host|connection (reset|refused|timed out)|network is unreachable|operation timed out|proxy|the requested url returned error: 5\d\d/.test(s)
  ) return 'network'
  if (
    /authentication failed|401|403|invalid username or password|bad credentials|terminal prompts disabled/.test(s)
  ) return 'auth'
  return 'other'
}

function authArgs(token: string | null): string[] {
  if (!token) return []
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`]
}

export async function fetchOrigin(repoPath: string, token: string | null, timeoutMs = 8000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(
      'git',
      [...authArgs(token), '-C', repoPath, 'fetch', '--quiet', 'origin'],
      { cwd: repoPath, env: { ...process.env, ...NON_INTERACTIVE_ENV } as NodeJS.ProcessEnv },
    )
    let stderr = ''
    let settled = false
    const settle = (ok: boolean) => { if (settled) return; settled = true; resolve({ ok, stderr }) }
    const t = setTimeout(() => { try { proc.kill('SIGKILL') } catch {/*noop*/} settle(false) }, timeoutMs)
    proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString() })
    proc.on('exit', (code: number | null) => { clearTimeout(t); settle(code === 0) })
    proc.on('error', () => { clearTimeout(t); settle(false) })
  })
}

export async function pushOrigin(repoPath: string, branch: string, token: string | null): Promise<{ ok: boolean; stderr: string }> {
  const r = await _internal.runGit(repoPath, [...authArgs(token), 'push', 'origin', branch])
  return { ok: r.exitCode === 0, stderr: r.stderr }
}

export async function mergeBase(repoPath: string, a: string, b: string): Promise<string> {
  const r = await _internal.runGit(repoPath, ['merge-base', a, b])
  if (r.exitCode !== 0) throw new Error(`git merge-base failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

export async function revListCount(repoPath: string, range: string): Promise<number> {
  const r = await _internal.runGit(repoPath, ['rev-list', '--count', range])
  if (r.exitCode !== 0) return 0
  const n = parseInt(r.stdout.toString('utf8').trim(), 10)
  return Number.isFinite(n) ? n : 0
}
