import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  exportClaude,
  generateClaudeStructure,
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

    expect(readFileSync(join(repoPath, 'global', 'CLAUDE.md'), 'utf8')).toBe('hello')
    expect(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8')).toBe('{"k":1}')
    expect(readFileSync(join(repoPath, 'global', 'commands', 'a.md'), 'utf8')).toBe('A')
    expect(readFileSync(join(repoPath, 'global', 'skills', 's', 'SKILL.md'), 'utf8')).toBe('S')
  })

  it('mirrors only memory subdir under projects/', () => {
    mkdirSync(join(claudePath, 'projects', 'p1', 'memory'), { recursive: true })
    mkdirSync(join(claudePath, 'projects', 'p1', 'sessions'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'p1', 'memory', 'note.md'), 'M')
    writeFileSync(join(claudePath, 'projects', 'p1', 'sessions', 's.jsonl'), 'X')

    exportClaude(claudePath, repoPath)

    expect(existsSync(join(repoPath, 'global', 'projects', 'p1', 'memory', 'note.md'))).toBe(true)
    expect(existsSync(join(repoPath, 'global', 'projects', 'p1', 'sessions'))).toBe(false)
  })

  it('removes files from destination when removed from source on second push', () => {
    mkdirSync(join(claudePath, 'commands'), { recursive: true })
    writeFileSync(join(claudePath, 'commands', 'a.md'), 'A')
    writeFileSync(join(claudePath, 'commands', 'b.md'), 'B')
    exportClaude(claudePath, repoPath)
    rmSync(join(claudePath, 'commands', 'b.md'))
    exportClaude(claudePath, repoPath)
    expect(existsSync(join(repoPath, 'global', 'commands', 'a.md'))).toBe(true)
    expect(existsSync(join(repoPath, 'global', 'commands', 'b.md'))).toBe(false)
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
      readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(written.env).toBeUndefined()
    expect(written.theme).toBe('dark')
  })

  it('places projects/<encoded>/memory at <repo>/global/projects/<encoded>/memory', () => {
    mkdirSync(join(claudePath, 'projects', 'enc', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'enc', 'memory', 'a.md'), 'A')
    generateClaudeStructure(claudePath, repoPath)
    expect(
      existsSync(join(repoPath, 'global', 'projects', 'enc', 'memory', 'a.md')),
    ).toBe(true)
  })
})

describe('stripSecretsInClaudeRepo', () => {
  it('removes env block from <repo>/global/settings.json', () => {
    mkdirSync(join(repoPath, 'global'), { recursive: true })
    writeFileSync(
      join(repoPath, 'global', 'settings.json'),
      JSON.stringify({ env: { S: 'x' }, k: 1 }),
    )
    stripSecretsInClaudeRepo(repoPath)
    const written = JSON.parse(
      readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(written.env).toBeUndefined()
    expect(written.k).toBe(1)
  })

  it('throws on invalid JSON', () => {
    mkdirSync(join(repoPath, 'global'), { recursive: true })
    writeFileSync(join(repoPath, 'global', 'settings.json'), '{not json')
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
