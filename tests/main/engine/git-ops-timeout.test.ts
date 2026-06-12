// tests/main/engine/git-ops-timeout.test.ts
// Timeout behavior for engine git calls: a hung git process must be killed and
// the promise must settle (reject / ok:false) so the op-lock is never starved.
// A local HTTP server that accepts requests and never responds makes
// fetch/push hang deterministically without real network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import {
  _internal,
  GitTimeoutError,
  pushOrigin,
  diffRawZ,
} from '../../../src/main/sync/engine/git-ops'

let dir: string
let server: Server
let silentUrl: string

function git(args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cs-git-timeout-'))
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@test'])
  git(['config', 'user.name', 'test'])
  git(['config', 'core.autocrlf', 'false'])
  mkdirSync(join(dir, 'claude'))
  writeFileSync(join(dir, 'claude', 'CLAUDE.md'), 'hello\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'init'])

  // HTTP server that accepts connections and never sends a response.
  server = createServer(() => { /* hang forever */ })
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  silentUrl = `http://127.0.0.1:${addr.port}/repo.git`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((res) => server.close(() => res()))
  // A killed git tree may release handles inside `dir` with a delay on
  // Windows (taskkill is async) — retry the removal for a few seconds.
  for (let i = 0; ; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      break
    } catch (e) {
      if (i >= 50) throw e
      await sleep(200)
    }
  }
})

describe('runGit timeout', () => {
  it('rejects with GitTimeoutError when git hangs, well before the process would finish', async () => {
    const started = Date.now()
    let caught: unknown
    try {
      await _internal.runGit(dir, ['fetch', silentUrl], { timeoutMs: 500 })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(GitTimeoutError)
    expect((caught as Error).message).toMatch(/timed out after 500ms/)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('normal plumbing is unaffected by the default timeout', async () => {
    const r = await _internal.runGit(dir, ['rev-parse', 'HEAD'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.toString('utf8').trim()).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('pushOrigin timeout', () => {
  it('returns ok:false with a timed-out stderr instead of hanging', async () => {
    git(['remote', 'add', 'origin', silentUrl])
    const r = await pushOrigin(dir, 'main', null, 500)
    expect(r.ok).toBe(false)
    expect(r.stderr).toMatch(/timed out/)
  })
})

describe('cleanupStaleGitLocks', () => {
  it('removes lock files created after `since` (our killed process)', () => {
    const lock = join(dir, '.git', 'index.lock')
    writeFileSync(lock, '')
    _internal.cleanupStaleGitLocks(dir, Date.now() - 60_000)
    expect(existsSync(lock)).toBe(false)
  })

  it('keeps lock files older than `since` (someone else owns them)', () => {
    const lock = join(dir, '.git', 'config.lock')
    writeFileSync(lock, '')
    const old = (Date.now() - 60_000) / 1000
    utimesSync(lock, old, old)
    _internal.cleanupStaleGitLocks(dir, Date.now())
    expect(existsSync(lock)).toBe(true)
  })

  it('removes the temp-index lock when indexFile is given', () => {
    const indexFile = join(dir, '.git', 'tmp-index-123')
    const lock = `${indexFile}.lock`
    writeFileSync(lock, '')
    _internal.cleanupStaleGitLocks(dir, Date.now() - 60_000, indexFile)
    expect(existsSync(lock)).toBe(false)
  })

  it('tolerates missing files and missing .git subdirs', () => {
    expect(() => _internal.cleanupStaleGitLocks(dir, Date.now())).not.toThrow()
  })
})

describe('lock cleanup after timeout kill', () => {
  it('removes a fresh index.lock left behind by the killed process', async () => {
    const hang = _internal.runGit(dir, ['fetch', silentUrl], { timeoutMs: 700 }).catch((e) => e)
    // Simulate the lock the hung git would be holding.
    await sleep(100)
    const lock = join(dir, '.git', 'index.lock')
    writeFileSync(lock, '')
    const err = await hang
    expect(err).toBeInstanceOf(GitTimeoutError)
    // Cleanup runs once the killed process actually exits — poll briefly.
    let gone = false
    for (let i = 0; i < 40; i++) {
      if (!existsSync(lock)) { gone = true; break }
      await sleep(50)
    }
    expect(gone).toBe(true)
  })
})

describe('diffRawZ', () => {
  it('returns raw -z diff output between two commits', async () => {
    writeFileSync(join(dir, 'claude', 'CLAUDE.md'), 'changed\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'change'])
    const out = await diffRawZ(dir, 'HEAD~1..HEAD', ['claude/'])
    expect(out).toContain(':100644')
    expect(out).toContain('claude/CLAUDE.md')
    expect(out).toContain('\0')
  })

  it('throws with the legacy message shape on git failure', async () => {
    await expect(diffRawZ(dir, 'nonsense..range', ['claude/'])).rejects.toThrow(/git diff exit \d+:/)
  })
})
