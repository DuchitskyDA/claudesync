import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enumClaudeSource, enumCursorProjectSource } from '../../../src/main/sync/engine/source-enum'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-src-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('enumClaudeSource', () => {
  it('returns CLAUDE.md, settings.json, commands/, skills/ entries with sha+size', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claude, 'settings.json'), '{"permissions":{"allow":["x"]},"numStartups":1}')
    mkdirSync(join(claude, 'commands'))
    writeFileSync(join(claude, 'commands', 'a.md'), 'A\n')

    const out = await enumClaudeSource(claude)
    const paths = out.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'claude/CLAUDE.md',
      'claude/commands/a.md',
      'claude/settings.json',
    ])
    const settings = out.find(e => e.repoPath === 'claude/settings.json')!
    // numStartups filtered out → content has only permissions
    expect(settings.size).toBe(Buffer.from('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}', 'utf8').length)
  })

  it('ignores plugins/, sessions/, history.jsonl, .credentials.json, settings.local.json', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'plugins'), { recursive: true })
    mkdirSync(join(claude, 'sessions'), { recursive: true })
    writeFileSync(join(claude, 'plugins', 'x.json'), 'X')
    writeFileSync(join(claude, 'sessions', 's.jsonl'), 'S')
    writeFileSync(join(claude, 'history.jsonl'), 'H')
    writeFileSync(join(claude, '.credentials.json'), 'C')
    writeFileSync(join(claude, 'settings.local.json'), '{}')
    const out = await enumClaudeSource(claude)
    expect(out).toEqual([])
  })

  it('includes only memory subdir of projects/<hash>', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    mkdirSync(join(claude, 'projects', 'abc', 'sessions'), { recursive: true })
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    writeFileSync(join(claude, 'projects', 'abc', 'sessions', 's.jsonl'), 'X')
    writeFileSync(join(claude, 'projects', 'abc', 'log.jsonl'), 'L')
    const out = await enumClaudeSource(claude)
    expect(out.map(e => e.repoPath)).toEqual(['claude/projects/abc/memory/n.md'])
  })

  it('returns [] when ~/.claude does not exist', async () => {
    const out = await enumClaudeSource(join(dir, 'no-such-dir'))
    expect(out).toEqual([])
  })

  it('skips files larger than 5MB with no throw', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    mkdirSync(join(claude, 'commands'), { recursive: true })
    const big = Buffer.alloc(6 * 1024 * 1024, 0)
    writeFileSync(join(claude, 'commands', 'big.md'), big)
    const out = await enumClaudeSource(claude)
    expect(out.find(e => e.repoPath === 'claude/commands/big.md')).toBeUndefined()
  })
})

describe('enumCursorProjectSource', () => {
  it('includes .cursor/rules/, .cursor/skills/, .cursorrules', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.cursor', 'rules'), { recursive: true })
    mkdirSync(join(proj, '.cursor', 'skills', 's'), { recursive: true })
    writeFileSync(join(proj, '.cursor', 'rules', 'r.mdc'), 'R')
    writeFileSync(join(proj, '.cursor', 'skills', 's', 'SKILL.md'), 'S')
    writeFileSync(join(proj, '.cursorrules'), 'C')
    const out = await enumCursorProjectSource(proj, 'MyProj')
    const paths = out.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'cursor/projects/MyProj/.cursor/rules/r.mdc',
      'cursor/projects/MyProj/.cursor/skills/s/SKILL.md',
      'cursor/projects/MyProj/.cursorrules',
    ])
  })
})
