import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig, validateLocalRepo, validateRepoUrl, validateRulesTarget } from '../../src/main/config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readConfig', () => {
  it('returns all-null when file does not exist', () => {
    expect(readConfig(join(dir, 'config.json'))).toEqual({ repoPath: null, repoUrl: null, rulesTarget: null })
  })

  it('returns all-null on invalid JSON', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '{not json')
    expect(readConfig(f)).toEqual({ repoPath: null, repoUrl: null, rulesTarget: null })
  })

  it('reads valid config with all three fields', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude' }))
    expect(readConfig(f)).toEqual({ repoPath: '/some/path', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude' })
  })

  it('reads legacy config with only repoPath (backwards compat)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path' }))
    expect(readConfig(f)).toEqual({ repoPath: '/some/path', repoUrl: null, rulesTarget: null })
  })
})

describe('writeConfig', () => {
  it('writes JSON atomically (round-trip with all fields)', () => {
    const f = join(dir, 'config.json')
    writeConfig(f, { repoPath: '/abc', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude' })
    expect(existsSync(f)).toBe(true)
    expect(readConfig(f)).toEqual({ repoPath: '/abc', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude' })
  })
})

describe('validateLocalRepo', () => {
  it('accepts non-existent path (will be created by clone)', () => {
    expect(validateLocalRepo(join(dir, 'nope'))).toEqual({ ok: true })
  })

  it('rejects non-empty folder that is not a git repo', () => {
    const repo = join(dir, 'busy')
    mkdirSync(repo)
    writeFileSync(join(repo, 'somefile.txt'), 'data')
    const r = validateLocalRepo(repo)
    expect(r.ok).toBe(false)
  })

  it('accepts empty folder', () => {
    const repo = join(dir, 'empty')
    mkdirSync(repo)
    expect(validateLocalRepo(repo)).toEqual({ ok: true })
  })

  it('accepts existing git repo (skips emptiness/install checks)', () => {
    const repo = join(dir, 'gitrepo')
    mkdirSync(repo)
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'somefile.txt'), 'data')
    expect(validateLocalRepo(repo)).toEqual({ ok: true })
  })

  it('rejects empty string', () => {
    const r = validateLocalRepo('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/required/i)
  })

  it('rejects relative path', () => {
    const r = validateLocalRepo('relative/path')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/absolute/i)
  })
})

describe('validateRepoUrl', () => {
  it('rejects empty string', () => {
    const r = validateRepoUrl('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/required/i)
  })

  it('rejects malformed URL', () => {
    const r = validateRepoUrl('not-a-url')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid url/i)
  })

  it('accepts https URL', () => {
    expect(validateRepoUrl('https://github.com/org/repo')).toEqual({ ok: true })
  })

  it('accepts https URL with .git suffix', () => {
    expect(validateRepoUrl('https://github.com/org/repo.git')).toEqual({ ok: true })
  })

  it('accepts SSH git@ URL', () => {
    expect(validateRepoUrl('git@github.com:org/repo.git')).toEqual({ ok: true })
  })
})

describe('validateRulesTarget', () => {
  it('rejects empty string', () => {
    const r = validateRulesTarget('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/required/i)
  })

  it('rejects relative path', () => {
    const r = validateRulesTarget('relative/path')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/absolute/i)
  })

  it('accepts absolute path', () => {
    expect(validateRulesTarget('/home/user/.claude')).toEqual({ ok: true })
  })

  it('accepts absolute path that does not exist yet', () => {
    expect(validateRulesTarget('/nonexistent/path/that/will/be/created')).toEqual({ ok: true })
  })
})
