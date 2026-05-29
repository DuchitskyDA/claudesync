import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enumClaudeSource, enumCursorProjectSource, enumClaudeProjectDotClaudeSource } from '../../../src/main/sync/engine/source-enum'

const ALL_ON = { claudeMd: true, commands: true, skills: true, settings: true }

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

    const out = await enumClaudeSource(claude, [], ALL_ON)
    const paths = out.entries.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'claude/CLAUDE.md',
      'claude/commands/a.md',
      'claude/settings.json',
    ])
    const settings = out.entries.find(e => e.repoPath === 'claude/settings.json')!
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
    const out = await enumClaudeSource(claude, [], ALL_ON)
    expect(out.entries).toEqual([])
  })

  it('includes only memory subdir of projects/<encoded>, mapped to registered <name>', async () => {
    const claude = join(dir, '.claude')
    // 'abc' is the local encoded segment; we register it as a project with
    // stable name 'myproj' so the repo path uses the canonical name.
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    mkdirSync(join(claude, 'projects', 'abc', 'sessions'), { recursive: true })
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    writeFileSync(join(claude, 'projects', 'abc', 'sessions', 's.jsonl'), 'X')
    writeFileSync(join(claude, 'projects', 'abc', 'log.jsonl'), 'L')
    // The registered project's `path`, when encoded, must equal 'abc'.
    // 'abc' has no path separators, so encoding /abc would be -abc; we use a
    // bare-segment path that round-trips to 'abc' by using a 3-char path.
    const out = await enumClaudeSource(claude,
      [{ name: 'myproj', path: 'abc', syncMemory: true, syncDotClaude: true }], ALL_ON)
    expect(out.entries.map(e => e.repoPath)).toEqual(['claude/projects/myproj/memory/n.md'])
  })

  it('skips projects/<encoded> when no project is registered for that segment', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    const out = await enumClaudeSource(claude, [], ALL_ON)
    expect(out.entries).toEqual([])
  })

  it('returns [] when ~/.claude does not exist', async () => {
    const out = await enumClaudeSource(join(dir, 'no-such-dir'), [], ALL_ON)
    expect(out.entries).toEqual([])
    expect(out.unreadable).toEqual([])
  })

  it('skips files larger than 5MB with no throw', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    mkdirSync(join(claude, 'commands'), { recursive: true })
    const big = Buffer.alloc(6 * 1024 * 1024, 0)
    writeFileSync(join(claude, 'commands', 'big.md'), big)
    const out = await enumClaudeSource(claude, [], ALL_ON)
    expect(out.entries.find(e => e.repoPath === 'claude/commands/big.md')).toBeUndefined()
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
    const paths = out.entries.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'cursor/projects/MyProj/.cursor/rules/r.mdc',
      'cursor/projects/MyProj/.cursor/skills/s/SKILL.md',
      'cursor/projects/MyProj/.cursorrules',
    ])
  })
})

describe('enumClaudeSource — syncGlobal gating', () => {
  it('claudeMd=false skips CLAUDE.md', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claude, 'settings.json'), '{"permissions":{"allow":["x"]}}')
    const out = await enumClaudeSource(claude, [], { ...ALL_ON, claudeMd: false })
    expect(out.entries.map(e => e.repoPath)).toEqual(['claude/settings.json'])
  })
  it('commands=false skips commands/*', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'commands'), { recursive: true })
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'commands', 'a.md'), 'A')
    const out = await enumClaudeSource(claude, [], { ...ALL_ON, commands: false })
    expect(out.entries.map(e => e.repoPath)).toEqual(['claude/CLAUDE.md'])
  })
  it('settings=false skips settings.json (does not canonicalize)', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'settings.json'), '{"permissions":{"allow":["x"]}}')
    const out = await enumClaudeSource(claude, [], { ...ALL_ON, settings: false })
    expect(out.entries.map(e => e.repoPath)).toEqual(['claude/CLAUDE.md'])
  })
  it('all false skips everything top-level but keeps memory', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    const off = { claudeMd: false, commands: false, skills: false, settings: false }
    const out = await enumClaudeSource(claude, [{ name: 'p', path: 'abc', syncMemory: true, syncDotClaude: true }], off)
    expect(out.entries.map(e => e.repoPath)).toEqual(['claude/projects/p/memory/n.md'])
  })
  it('per-project syncMemory=false skips memory for that project', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    const out = await enumClaudeSource(claude,
      [{ name: 'p', path: 'abc', syncMemory: false, syncDotClaude: true }], ALL_ON)
    expect(out.entries).toEqual([])
  })
})

describe('enumClaudeProjectDotClaudeSource', () => {
  it('returns CLAUDE.md, settings.json (canonicalized), commands/, skills/', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.claude', 'commands'), { recursive: true })
    mkdirSync(join(proj, '.claude', 'skills', 's'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(proj, '.claude', 'settings.json'),
      '{"permissions":{"allow":["x"]},"numStartups":1}')
    writeFileSync(join(proj, '.claude', 'commands', 'a.md'), 'A')
    writeFileSync(join(proj, '.claude', 'skills', 's', 'SKILL.md'), 'S')
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    const paths = out.entries.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'claude/projects/MyProj/.claude/CLAUDE.md',
      'claude/projects/MyProj/.claude/commands/a.md',
      'claude/projects/MyProj/.claude/settings.json',
      'claude/projects/MyProj/.claude/skills/s/SKILL.md',
    ])
    const settings = out.entries.find(e => e.repoPath === 'claude/projects/MyProj/.claude/settings.json')!
    expect(settings.size).toBe(
      Buffer.from('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}', 'utf8').length,
    )
  })
  it('ignores settings.local.json, worktrees/, scheduled_tasks.lock, .credentials.json', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.claude', 'worktrees', 'wt'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'settings.local.json'), '{}')
    writeFileSync(join(proj, '.claude', 'scheduled_tasks.lock'), 'lock')
    writeFileSync(join(proj, '.claude', '.credentials.json'), 'C')
    writeFileSync(join(proj, '.claude', 'worktrees', 'wt', 'x'), 'X')
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    expect(out.entries).toEqual([])
  })
  it('returns [] when <project>/.claude/ does not exist', async () => {
    const proj = join(dir, 'no-dot-claude')
    mkdirSync(proj)
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    expect(out.entries).toEqual([])
  })
})

describe('enumClaudeSource — unreadable surfacing', () => {
  it('broken settings.json → unreadable, not omitted, not deleted', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'settings.json'), '{ not valid json ')
    const out = await enumClaudeSource(claude, [], { claudeMd: true, commands: true, skills: true, settings: true })
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/CLAUDE.md'])
    expect(out.unreadable).toContain('claude/settings.json')
  })

  it('oversized file → unreadable', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'commands'), { recursive: true })
    writeFileSync(join(claude, 'commands', 'big.md'), Buffer.alloc(6 * 1024 * 1024, 0x61))
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    const out = await enumClaudeSource(claude, [], { claudeMd: true, commands: true, skills: true, settings: true })
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/CLAUDE.md'])
    expect(out.unreadable).toContain('claude/commands/big.md')
  })

  it('returns empty result (not throw) when claudePath missing', async () => {
    const out = await enumClaudeSource(join(dir, 'nope'), [], { claudeMd: true, commands: true, skills: true, settings: true })
    expect(out.entries).toEqual([])
    expect(out.unreadable).toEqual([])
  })
})

describe('enumClaudeProjectDotClaudeSource — result shape', () => {
  it('returns { entries, unreadable }', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.claude'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'CLAUDE.md'), 'hi\n')
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/projects/MyProj/.claude/CLAUDE.md'])
    expect(out.unreadable).toEqual([])
  })
})
