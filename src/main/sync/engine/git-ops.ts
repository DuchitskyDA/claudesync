// src/main/sync/engine/git-ops.ts
import { spawn } from 'node:child_process'

export type LsTreeEntry = {
  mode: '100644' | '100755'
  sha: string
  repoPath: string
  size: number
}

function runGit(
  cwd: string,
  args: string[],
  opts: { stdin?: Buffer; env?: Record<string, string> } = {},
): Promise<{ exitCode: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      env: opts.env ? { ...process.env, ...opts.env } as NodeJS.ProcessEnv : process.env,
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
