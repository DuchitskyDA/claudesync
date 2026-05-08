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
    expect(readConfig(join(dir, 'config.json'))).toEqual({ repoPath: null, repoUrl: null, rulesTarget: null, includeSecretsInPush: false, locale: null })
  })

  it('returns all-null on invalid JSON', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '{not json')
    expect(readConfig(f)).toEqual({ repoPath: null, repoUrl: null, rulesTarget: null, includeSecretsInPush: false, locale: null })
  })

  it('reads valid config with all three fields', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude' }))
    expect(readConfig(f)).toEqual({ repoPath: '/some/path', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude', includeSecretsInPush: false, locale: null })
  })

  it('reads legacy config with only repoPath (backwards compat)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path' }))
    expect(readConfig(f)).toEqual({ repoPath: '/some/path', repoUrl: null, rulesTarget: null, includeSecretsInPush: false, locale: null })
  })

  it('reads includeSecretsInPush=true when set', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/x', includeSecretsInPush: true }))
    expect(readConfig(f)).toEqual({
      repoPath: null,
      repoUrl: null,
      rulesTarget: '/x',
      includeSecretsInPush: true,
      locale: null,
    })
  })

  it('reads locale from config file (en)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/x', locale: 'en' }))
    expect(readConfig(f).locale).toBe('en')
  })

  it('reads locale from config file (ru)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/x', locale: 'ru' }))
    expect(readConfig(f).locale).toBe('ru')
  })

  it('returns null locale when missing', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/x' }))
    expect(readConfig(f).locale).toBeNull()
  })

  it('returns null locale for unsupported value', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/x', locale: 'fr' }))
    expect(readConfig(f).locale).toBeNull()
  })
})

describe('writeConfig', () => {
  it('writes JSON atomically (round-trip with all fields)', () => {
    const f = join(dir, 'config.json')
    writeConfig(f, { repoPath: '/abc', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude', includeSecretsInPush: false, locale: null })
    expect(existsSync(f)).toBe(true)
    expect(readConfig(f)).toEqual({ repoPath: '/abc', repoUrl: 'https://github.com/org/repo', rulesTarget: '/home/user/.claude', includeSecretsInPush: false, locale: null })
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
    if (!r.ok) expect(r.error.key).toBe('config.error.localRepoRequired')
  })

  it('rejects relative path', () => {
    const r = validateLocalRepo('relative/path')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('config.error.localRepoAbsolute')
  })
})

describe('validateRepoUrl', () => {
  it('rejects empty string', () => {
    const r = validateRepoUrl('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('config.error.urlRequired')
  })

  it('rejects malformed URL', () => {
    const r = validateRepoUrl('not-a-url')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('config.error.urlInvalid')
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
    if (!r.ok) expect(r.error.key).toBe('config.error.targetRequired')
  })

  it('rejects relative path', () => {
    const r = validateRulesTarget('relative/path')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('config.error.targetAbsolute')
  })

  it('accepts absolute path', () => {
    expect(validateRulesTarget('/home/user/.claude')).toEqual({ ok: true })
  })

  it('accepts absolute path that does not exist yet', () => {
    expect(validateRulesTarget('/nonexistent/path/that/will/be/created')).toEqual({ ok: true })
  })

  it('accepts ~/.claude (tilde expansion)', () => {
    expect(validateRulesTarget('~/.claude')).toEqual({ ok: true })
  })
})

describe('validateLocalRepo tilde expansion', () => {
  it('accepts ~/some-non-existent-folder-12345 (tilde expansion, non-existent ok)', () => {
    expect(validateLocalRepo('~/some-non-existent-folder-12345')).toEqual({ ok: true })
  })
})
