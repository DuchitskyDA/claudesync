import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readConfig,
  writeConfig,
  validateLocalRepo,
  validateRepoUrl,
  validateClaudePath,
  validateRulesTarget,
  validateCursorProject,
  validateCatalogUrl,
} from '../../src/main/config'
import type { AppConfig } from '@shared/api'

let dir: string

// Includes the transitional `rulesTarget` shim that mirrors `claude.path`.
// readConfig populates it; writeConfig drops it on save.
const baseDefaults: AppConfig = {
  repoPath: null,
  repoUrl: null,
  includeSecretsInPush: false,
  locale: null,
  lastDismissedUpdate: null,
  claude: {
    enabled: false,
    path: null,
    projects: [],
    syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
  },
  cursor: { enabled: false, projects: [] },
  catalogUrl: null,
  rulesTarget: null,
  manifestActivation: {},
  knownEntryIds: [],
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readConfig', () => {
  it('returns defaults when file does not exist', () => {
    expect(readConfig(join(dir, 'config.json'))).toEqual({ ...baseDefaults })
  })

  it('returns defaults on invalid JSON', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '{not json')
    expect(readConfig(f)).toEqual({ ...baseDefaults })
  })

  it('reads valid v0.9 config (claude/cursor blocks)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        repoPath: '/some/path',
        repoUrl: 'https://github.com/org/repo',
        claude: { enabled: true, path: '/home/user/.claude', projects: [] },
        cursor: { enabled: false, projects: [] },
      }),
    )
    expect(readConfig(f)).toEqual({
      ...baseDefaults,
      repoPath: '/some/path',
      repoUrl: 'https://github.com/org/repo',
      claude: {
        enabled: true,
        path: '/home/user/.claude',
        projects: [],
        syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
      },
      rulesTarget: '/home/user/.claude',
    })
  })

  it('reads legacy config with only repoPath (backwards compat)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path' }))
    expect(readConfig(f)).toEqual({ ...baseDefaults, repoPath: '/some/path' })
  })

  it('reads includeSecretsInPush=true when set', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/x', includeSecretsInPush: true }))
    expect(readConfig(f)).toEqual({
      ...baseDefaults,
      includeSecretsInPush: true,
      claude: {
        enabled: true,
        path: '/x',
        projects: [],
        syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
      },
      rulesTarget: '/x',
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

describe('readConfig migration to multi-target', () => {
  it('migrates legacy rulesTarget into claude block', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        repoPath: '/some/path',
        repoUrl: 'https://github.com/org/repo',
        rulesTarget: '/home/user/.claude',
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude).toEqual({
      enabled: true,
      path: '/home/user/.claude',
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    })
    expect(cfg.cursor).toEqual({ enabled: false, projects: [] })
  })

  it('uses claude/cursor blocks when present (no migration from rulesTarget)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        repoPath: '/p',
        repoUrl: null,
        rulesTarget: '/legacy',
        claude: { enabled: false, path: '/x/.claude' },
        cursor: { enabled: true, projects: [{ name: 'app', path: '/repos/app' }] },
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude).toEqual({
      enabled: false,
      path: '/x/.claude',
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    })
    expect(cfg.cursor.projects).toEqual([{ name: 'app', path: '/repos/app' }])
    expect(cfg.rulesTarget).toBe('/x/.claude')
  })

  it('returns disabled defaults when no rulesTarget and no blocks', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/p' }))
    const cfg = readConfig(f)
    expect(cfg.claude).toEqual({
      enabled: false,
      path: null,
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    })
    expect(cfg.cursor).toEqual({ enabled: false, projects: [] })
  })

  it('drops invalid project entries silently', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        cursor: {
          enabled: true,
          projects: [
            { name: 'ok', path: '/a' },
            { name: 123 },
            'garbage',
            { path: '/b' },
            { name: 'also-ok', path: '/b' },
          ],
        },
      }),
    )
    expect(readConfig(f).cursor.projects).toEqual([
      { name: 'ok', path: '/a' },
      { name: 'also-ok', path: '/b' },
    ])
  })

  it('writeConfig drops rulesTarget from disk', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/legacy' }))
    const cfg = readConfig(f)
    writeConfig(f, cfg)
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
    expect(raw.rulesTarget).toBeUndefined()
    expect(raw.claude).toEqual({
      enabled: true,
      path: '/legacy',
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    })
  })
})

describe('writeConfig', () => {
  it('writes JSON atomically (round-trip with claude/cursor blocks)', () => {
    const f = join(dir, 'config.json')
    writeConfig(f, {
      ...baseDefaults,
      repoPath: '/abc',
      repoUrl: 'https://github.com/org/repo',
      claude: {
        enabled: true,
        path: '/home/user/.claude',
        projects: [],
        syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true, plugins: false },
      },
    })
    expect(existsSync(f)).toBe(true)
    expect(readConfig(f)).toEqual({
      ...baseDefaults,
      repoPath: '/abc',
      repoUrl: 'https://github.com/org/repo',
      claude: {
        enabled: true,
        path: '/home/user/.claude',
        projects: [],
        syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true, plugins: false },
      },
      rulesTarget: '/home/user/.claude',
    })
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

describe('validateClaudePath', () => {
  it('rejects null', () => {
    const r = validateClaudePath(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('config.error.targetRequired')
  })

  it('rejects empty string', () => {
    const r = validateClaudePath('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('config.error.targetRequired')
  })

  it('rejects relative path', () => {
    const r = validateClaudePath('relative/path')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('config.error.targetAbsolute')
  })

  it('accepts absolute path', () => {
    expect(validateClaudePath('/home/user/.claude')).toEqual({ ok: true })
  })

  it('accepts absolute path that does not exist yet', () => {
    expect(validateClaudePath('/nonexistent/path/that/will/be/created')).toEqual({ ok: true })
  })

  it('accepts ~/.claude (tilde expansion)', () => {
    expect(validateClaudePath('~/.claude')).toEqual({ ok: true })
  })
})

describe('validateRulesTarget (legacy alias)', () => {
  it('still accepts absolute paths', () => {
    expect(validateRulesTarget('/x')).toEqual({ ok: true })
  })
})

describe('validateCursorProject', () => {
  let okPath: string

  beforeEach(() => {
    okPath = join(dir, 'app')
    mkdirSync(okPath)
  })

  it('accepts valid project', () => {
    expect(validateCursorProject({ name: 'app', path: okPath })).toEqual({ ok: true })
  })

  it('rejects empty name', () => {
    expect(validateCursorProject({ name: '', path: okPath }).ok).toBe(false)
  })

  it('rejects name with forward slash', () => {
    expect(validateCursorProject({ name: 'a/b', path: okPath }).ok).toBe(false)
  })

  it('rejects name with backslash', () => {
    expect(validateCursorProject({ name: 'a\\b', path: okPath }).ok).toBe(false)
  })

  it('rejects reserved name "."', () => {
    expect(validateCursorProject({ name: '.', path: okPath }).ok).toBe(false)
  })

  it('rejects reserved name ".."', () => {
    expect(validateCursorProject({ name: '..', path: okPath }).ok).toBe(false)
  })

  it('rejects name with leading whitespace', () => {
    expect(validateCursorProject({ name: ' app', path: okPath }).ok).toBe(false)
  })

  it('rejects name with trailing whitespace', () => {
    expect(validateCursorProject({ name: 'app ', path: okPath }).ok).toBe(false)
  })

  it('rejects relative path', () => {
    expect(validateCursorProject({ name: 'app', path: 'rel/path' }).ok).toBe(false)
  })

  it('rejects non-existent path', () => {
    expect(validateCursorProject({ name: 'app', path: join(dir, 'missing') }).ok).toBe(false)
  })

  it('rejects path that is a file, not directory', () => {
    const filePath = join(dir, 'file.txt')
    writeFileSync(filePath, 'x')
    expect(validateCursorProject({ name: 'app', path: filePath }).ok).toBe(false)
  })
})

describe('validateLocalRepo tilde expansion', () => {
  it('accepts ~/some-non-existent-folder-12345 (tilde expansion, non-existent ok)', () => {
    expect(validateLocalRepo('~/some-non-existent-folder-12345')).toEqual({ ok: true })
  })
})

describe('validateCatalogUrl', () => {
  it('accepts null (use default)', () => {
    expect(validateCatalogUrl(null)).toEqual({ ok: true })
  })

  it('accepts empty string (use default)', () => {
    expect(validateCatalogUrl('')).toEqual({ ok: true })
  })

  it('accepts whitespace-only string (use default)', () => {
    expect(validateCatalogUrl('   ')).toEqual({ ok: true })
  })

  it('accepts valid https URL', () => {
    expect(
      validateCatalogUrl('https://raw.githubusercontent.com/user/repo/main/index.json'),
    ).toEqual({ ok: true })
  })

  it('accepts valid http URL', () => {
    expect(validateCatalogUrl('http://example.com/catalog.json')).toEqual({ ok: true })
  })

  it('rejects bare hostname', () => {
    expect(validateCatalogUrl('example.com').ok).toBe(false)
  })

  it('rejects non-http schemes', () => {
    expect(validateCatalogUrl('git@github.com:user/repo.git').ok).toBe(false)
    expect(validateCatalogUrl('ftp://files.example.com/a.json').ok).toBe(false)
  })

  it('rejects garbage strings', () => {
    expect(validateCatalogUrl('not a url').ok).toBe(false)
  })
})

describe('readConfig migration to flexible sync toggles', () => {
  it('fills missing syncGlobal with all-true defaults', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        claude: { enabled: true, path: '/home/u/.claude', projects: [] },
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude.syncGlobal).toEqual({
      claudeMd: true,
      commands: true,
      skills: true,
      settings: true,
    })
  })

  it('preserves explicit syncGlobal values', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        claude: {
          enabled: true,
          path: '/x',
          projects: [],
          syncGlobal: { claudeMd: true, commands: false, skills: true, settings: false },
        },
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude.syncGlobal).toEqual({
      claudeMd: true, commands: false, skills: true, settings: false, plugins: false,
    })
  })

  it('fills missing per-project syncMemory/syncDotClaude with true', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        claude: {
          enabled: true,
          path: '/x',
          projects: [{ name: 'a', path: '/p/a' }, { name: 'b', path: '/p/b', syncDotClaude: false }],
        },
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude.projects).toEqual([
      { name: 'a', path: '/p/a', syncMemory: true, syncDotClaude: true },
      { name: 'b', path: '/p/b', syncMemory: true, syncDotClaude: false },
    ])
  })

  it('writeConfig round-trips syncGlobal and per-project flags', () => {
    const f = join(dir, 'config.json')
    const cfg: AppConfig = {
      ...baseDefaults,
      claude: {
        enabled: true,
        path: '/x',
        projects: [{ name: 'a', path: '/p/a', syncMemory: false, syncDotClaude: true }],
        syncGlobal: { claudeMd: false, commands: true, skills: true, settings: true, plugins: false },
      },
      rulesTarget: '/x',
    }
    writeConfig(f, cfg)
    expect(readConfig(f).claude).toEqual(cfg.claude)
  })
})

describe('readConfig manifest device-state migration', () => {
  it('defaults manifestActivation/knownEntryIds to empty when absent', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ claude: { enabled: true, path: '/x', projects: [] } }))
    const cfg = readConfig(f)
    expect(cfg.manifestActivation).toEqual({})
    expect(cfg.knownEntryIds).toEqual([])
  })
  it('preserves explicit manifest device-state', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({
      claude: { enabled: true, path: '/x', projects: [] },
      manifestActivation: { 'claude-global:commands': false },
      knownEntryIds: ['claude-global:commands'],
    }))
    const cfg = readConfig(f)
    expect(cfg.manifestActivation).toEqual({ 'claude-global:commands': false })
    expect(cfg.knownEntryIds).toEqual(['claude-global:commands'])
  })
  it('writeConfig round-trips device-state', () => {
    const f = join(dir, 'config.json')
    const cfg: AppConfig = {
      ...baseDefaults,
      manifestActivation: { 'project:erp:memory': true },
      knownEntryIds: ['project:erp:memory'],
    }
    writeConfig(f, cfg)
    expect(readConfig(f).manifestActivation).toEqual({ 'project:erp:memory': true })
    expect(readConfig(f).knownEntryIds).toEqual(['project:erp:memory'])
  })
})
