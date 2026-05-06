import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig, validateRepoPath } from '../../src/main/config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readConfig', () => {
  it('returns {repoPath: null} when file does not exist', () => {
    expect(readConfig(join(dir, 'config.json'))).toEqual({ repoPath: null })
  })

  it('returns {repoPath: null} on invalid JSON', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '{not json')
    expect(readConfig(f)).toEqual({ repoPath: null })
  })

  it('reads valid config', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path' }))
    expect(readConfig(f)).toEqual({ repoPath: '/some/path' })
  })
})

describe('writeConfig', () => {
  it('writes JSON atomically (round-trip)', () => {
    const f = join(dir, 'config.json')
    writeConfig(f, { repoPath: '/abc' })
    expect(existsSync(f)).toBe(true)
    expect(readConfig(f)).toEqual({ repoPath: '/abc' })
  })
})

describe('validateRepoPath', () => {
  it('rejects non-existent path', () => {
    const r = validateRepoPath(join(dir, 'nope'))
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toMatch(/not found|does not exist/i)
  })

  it('rejects path that is not a git repo', () => {
    const repo = join(dir, 'not-git')
    mkdirSync(repo)
    const r = validateRepoPath(repo)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toMatch(/git repository/i)
  })

  it('rejects git repo without install scripts', () => {
    const repo = join(dir, 'git-only')
    mkdirSync(repo)
    mkdirSync(join(repo, '.git'))
    const r = validateRepoPath(repo)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toMatch(/install\.sh|install\.ps1/i)
  })

  it('accepts git repo with install.sh', () => {
    const repo = join(dir, 'ok-mac')
    mkdirSync(repo)
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'install.sh'), '#!/usr/bin/env bash\n')
    expect(validateRepoPath(repo)).toEqual({ ok: true })
  })

  it('accepts git repo with install.ps1', () => {
    const repo = join(dir, 'ok-win')
    mkdirSync(repo)
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'install.ps1'), '# ps')
    expect(validateRepoPath(repo)).toEqual({ ok: true })
  })

  it('accepts .git as a file (worktree/submodule case)', () => {
    const repo = join(dir, 'worktree')
    mkdirSync(repo)
    writeFileSync(join(repo, '.git'), 'gitdir: ../main/.git/worktrees/foo')
    writeFileSync(join(repo, 'install.sh'), '#!/usr/bin/env bash\n')
    expect(validateRepoPath(repo)).toEqual({ ok: true })
  })
})
