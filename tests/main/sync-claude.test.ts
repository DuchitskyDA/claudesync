import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  exportClaude,
  generateClaudeStructure,
  installClaude,
  stripSecretsInClaudeRepo,
  detectClaudeInstallMode,
} from '../../src/main/sync/claude'

let dir: string
let claudePath: string
let repoPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-cl-'))
  claudePath = join(dir, 'claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath, { recursive: true })
  mkdirSync(repoPath, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('exportClaude', () => {
  it('mirrors CLAUDE.md, settings.json, commands/, skills/ into <repo>/global/', () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello')
    writeFileSync(join(claudePath, 'settings.json'), '{"k":1}')
    mkdirSync(join(claudePath, 'commands'))
    writeFileSync(join(claudePath, 'commands', 'a.md'), 'A')
    mkdirSync(join(claudePath, 'skills', 's'), { recursive: true })
    writeFileSync(join(claudePath, 'skills', 's', 'SKILL.md'), 'S')

    exportClaude(claudePath, repoPath)

    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('hello')
    expect(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8')).toBe('{"k":1}')
    expect(readFileSync(join(repoPath, 'claude', 'commands', 'a.md'), 'utf8')).toBe('A')
    expect(readFileSync(join(repoPath, 'claude', 'skills', 's', 'SKILL.md'), 'utf8')).toBe('S')
  })

  it('mirrors only memory subdir under projects/', () => {
    mkdirSync(join(claudePath, 'projects', 'p1', 'memory'), { recursive: true })
    mkdirSync(join(claudePath, 'projects', 'p1', 'sessions'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'p1', 'memory', 'note.md'), 'M')
    writeFileSync(join(claudePath, 'projects', 'p1', 'sessions', 's.jsonl'), 'X')

    exportClaude(claudePath, repoPath)

    expect(existsSync(join(repoPath, 'claude', 'projects', 'p1', 'memory', 'note.md'))).toBe(true)
    expect(existsSync(join(repoPath, 'claude', 'projects', 'p1', 'sessions'))).toBe(false)
  })

  it('removes files from destination when removed from source on second push', () => {
    mkdirSync(join(claudePath, 'commands'), { recursive: true })
    writeFileSync(join(claudePath, 'commands', 'a.md'), 'A')
    writeFileSync(join(claudePath, 'commands', 'b.md'), 'B')
    exportClaude(claudePath, repoPath)
    rmSync(join(claudePath, 'commands', 'b.md'))
    exportClaude(claudePath, repoPath)
    expect(existsSync(join(repoPath, 'claude', 'commands', 'a.md'))).toBe(true)
    expect(existsSync(join(repoPath, 'claude', 'commands', 'b.md'))).toBe(false)
  })
})

describe('generateClaudeStructure', () => {
  it('strips env from settings.json on first commit', () => {
    writeFileSync(
      join(claudePath, 'settings.json'),
      JSON.stringify({ env: { SECRET: 'x' }, theme: 'dark' }),
    )
    generateClaudeStructure(claudePath, repoPath)
    const written = JSON.parse(
      readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(written.env).toBeUndefined()
    expect(written.theme).toBe('dark')
  })

  it('places projects/<encoded>/memory at <repo>/global/projects/<encoded>/memory', () => {
    mkdirSync(join(claudePath, 'projects', 'enc', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'enc', 'memory', 'a.md'), 'A')
    generateClaudeStructure(claudePath, repoPath)
    expect(
      existsSync(join(repoPath, 'claude', 'projects', 'enc', 'memory', 'a.md')),
    ).toBe(true)
  })
})

describe('stripSecretsInClaudeRepo', () => {
  it('removes env block from <repo>/global/settings.json', () => {
    mkdirSync(join(repoPath, 'claude'), { recursive: true })
    writeFileSync(
      join(repoPath, 'claude', 'settings.json'),
      JSON.stringify({ env: { S: 'x' }, k: 1 }),
    )
    stripSecretsInClaudeRepo(repoPath)
    const written = JSON.parse(
      readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(written.env).toBeUndefined()
    expect(written.k).toBe(1)
  })

  it('throws on invalid JSON', () => {
    mkdirSync(join(repoPath, 'claude'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'settings.json'), '{not json')
    expect(() => stripSecretsInClaudeRepo(repoPath)).toThrow(/Invalid JSON/)
  })
})

describe('detectClaudeInstallMode', () => {
  it('returns "copy" when CLAUDE.md does not exist', () => {
    expect(detectClaudeInstallMode(claudePath)).toBe('copy')
  })

  it('returns "copy" when CLAUDE.md is a regular file', () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hi')
    expect(detectClaudeInstallMode(claudePath)).toBe('copy')
  })
})

describe('installClaude (reverse-mirror after Discard)', () => {
  function seedRepo(): void {
    mkdirSync(join(repoPath, 'claude', 'commands'), { recursive: true })
    mkdirSync(join(repoPath, 'claude', 'skills', 's1'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'REPO-CLAUDE')
    writeFileSync(
      join(repoPath, 'claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { p: true }, theme: 'dark' }),
    )
    writeFileSync(join(repoPath, 'claude', 'commands', 'a.md'), 'REPO-A')
    writeFileSync(join(repoPath, 'claude', 'skills', 's1', 'SKILL.md'), 'REPO-S')
  }

  it('mirrors repo back into claudePath in copy mode', () => {
    seedRepo()
    // Source has different / missing content — must be replaced.
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'LOCAL-OUTDATED')

    installClaude(repoPath, claudePath)

    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('REPO-CLAUDE')
    expect(readFileSync(join(claudePath, 'commands', 'a.md'), 'utf8')).toBe('REPO-A')
    expect(readFileSync(join(claudePath, 'skills', 's1', 'SKILL.md'), 'utf8')).toBe('REPO-S')
  })

  it('preserves local env block in settings.json (not present in repo HEAD)', () => {
    seedRepo()
    writeFileSync(
      join(claudePath, 'settings.json'),
      JSON.stringify({
        enabledPlugins: { local: true },
        theme: 'light',
        env: { ANTHROPIC_API_KEY: 'sk-secret', OPENAI_API_KEY: 'sk-other' },
      }),
    )

    installClaude(repoPath, claudePath)

    const written = JSON.parse(
      readFileSync(join(claudePath, 'settings.json'), 'utf8'),
    ) as Record<string, unknown>
    // Repo wins on regular keys ...
    expect((written.enabledPlugins as Record<string, unknown>).p).toBe(true)
    expect((written.enabledPlugins as Record<string, unknown>).local).toBeUndefined()
    expect(written.theme).toBe('dark')
    // ... but local env survives, since the repo never has it (stripped on push).
    expect(written.env).toEqual({ ANTHROPIC_API_KEY: 'sk-secret', OPENAI_API_KEY: 'sk-other' })
  })

  it('falls back to plain copy when repo settings.json is unparseable', () => {
    mkdirSync(join(repoPath, 'claude'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'settings.json'), '{not json')

    installClaude(repoPath, claudePath)

    expect(readFileSync(join(claudePath, 'settings.json'), 'utf8')).toBe('{not json')
  })

  it('removes claudePath files that no longer exist in repo (mirror semantics)', () => {
    seedRepo()
    mkdirSync(join(claudePath, 'commands'), { recursive: true })
    writeFileSync(join(claudePath, 'commands', 'gone.md'), 'orphan')

    installClaude(repoPath, claudePath)

    expect(existsSync(join(claudePath, 'commands', 'gone.md'))).toBe(false)
    expect(existsSync(join(claudePath, 'commands', 'a.md'))).toBe(true)
  })

  it('is a no-op in symlink install mode', () => {
    // Make CLAUDE.md a symlink so detectClaudeInstallMode returns "symlink".
    const target = join(dir, 'symlink-target.md')
    writeFileSync(target, 'TARGET-CONTENT')
    symlinkSync(target, join(claudePath, 'CLAUDE.md'))
    expect(detectClaudeInstallMode(claudePath)).toBe('symlink')

    // Repo has different content — installClaude must NOT touch it.
    seedRepo()

    installClaude(repoPath, claudePath)

    // Symlink stayed pointing at original target — content unchanged.
    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('TARGET-CONTENT')
    // And no settings.json was forcefully created in claudePath either.
    expect(existsSync(join(claudePath, 'settings.json'))).toBe(false)
  })

  it('does not crash when repo has no claude/ subdir (fresh install)', () => {
    expect(() => installClaude(repoPath, claudePath)).not.toThrow()
    expect(existsSync(join(claudePath, 'CLAUDE.md'))).toBe(false)
  })

  it('does not write env when claudePath settings.json is missing', () => {
    seedRepo()
    installClaude(repoPath, claudePath)
    const written = JSON.parse(
      readFileSync(join(claudePath, 'settings.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(written.env).toBeUndefined()
  })
})
