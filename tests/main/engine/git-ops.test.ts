// tests/main/engine/git-ops.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { lsTree, catFileBlob, hashObjectWrite } from '../../../src/main/sync/engine/git-ops'

let dir: string

function git(args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-git-'))
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@test'])
  git(['config', 'user.name', 'test'])
  mkdirSync(join(dir, 'claude'))
  writeFileSync(join(dir, 'claude', 'CLAUDE.md'), 'hello\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'init'])
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('lsTree', () => {
  it('lists files under prefix at HEAD', async () => {
    const out = await lsTree(dir, 'HEAD', 'claude/')
    expect(out).toHaveLength(1)
    expect(out[0]?.repoPath).toBe('claude/CLAUDE.md')
    expect(out[0]?.mode).toBe('100644')
    expect(out[0]?.sha).toMatch(/^[0-9a-f]{40}$/)
  })
  it('returns empty when prefix has no entries', async () => {
    const out = await lsTree(dir, 'HEAD', 'cursor/')
    expect(out).toEqual([])
  })
})

describe('catFileBlob', () => {
  it('returns blob content as Buffer', async () => {
    const tree = await lsTree(dir, 'HEAD', 'claude/')
    const sha = tree[0]!.sha
    const buf = await catFileBlob(dir, sha)
    expect(buf.toString('utf8')).toBe('hello\n')
  })
})

describe('hashObjectWrite', () => {
  it('writes blob and returns its sha; same content → same sha', async () => {
    const buf = Buffer.from('test content\n', 'utf8')
    const sha1 = await hashObjectWrite(dir, buf)
    const sha2 = await hashObjectWrite(dir, buf)
    expect(sha1).toBe(sha2)
    expect(sha1).toMatch(/^[0-9a-f]{40}$/)
    const roundtrip = await catFileBlob(dir, sha1)
    expect(roundtrip.equals(buf)).toBe(true)
  })
})
