// tests/main/engine/rules.test.ts
import { describe, it, expect } from 'vitest'
import {
  isClaudePathSynced,
  isClaudePathIgnored,
  filterSettingsObject,
} from '../../../src/main/sync/engine/rules'

describe('SyncRules — Claude top-level', () => {
  it('CLAUDE.md, settings.json, commands/, skills/ are synced', () => {
    expect(isClaudePathSynced('CLAUDE.md')).toBe(true)
    expect(isClaudePathSynced('settings.json')).toBe(true)
    expect(isClaudePathSynced('commands/a.md')).toBe(true)
    expect(isClaudePathSynced('skills/foo/SKILL.md')).toBe(true)
  })
  it('plugins/, sessions/, history.jsonl, credentials, settings.local.json are ignored', () => {
    expect(isClaudePathIgnored('plugins/cache/x')).toBe(true)
    expect(isClaudePathIgnored('history.jsonl')).toBe(true)
    expect(isClaudePathIgnored('.credentials.json')).toBe(true)
    expect(isClaudePathIgnored('settings.local.json')).toBe(true)
    expect(isClaudePathIgnored('ide/foo')).toBe(true)
    expect(isClaudePathIgnored('statsig/anything')).toBe(true)
  })
  it('projects/<hash>/memory/ is synced, projects/<hash>/sessions/ is ignored', () => {
    expect(isClaudePathSynced('projects/abc123/memory/note.md')).toBe(true)
    expect(isClaudePathIgnored('projects/abc123/sessions/s.jsonl')).toBe(true)
    expect(isClaudePathIgnored('projects/abc123/x.jsonl')).toBe(true)
  })
  it('backup-files and OS junk ignored', () => {
    expect(isClaudePathIgnored('CLAUDE.md.backup.20260101-120000')).toBe(true)
    expect(isClaudePathIgnored('.DS_Store')).toBe(true)
    expect(isClaudePathIgnored('Thumbs.db')).toBe(true)
  })
})

describe('SyncRules — settings.json filter', () => {
  it('keeps allow-list keys, drops volatile + env', () => {
    const input = {
      permissions: { allow: ['x'] },
      numStartups: 42,
      cachedChangelog: 'foo',
      env: { SECRET: 'k' },
      theme: 'dark',
      tipsHistory: { tip: 1 },
    }
    const out = filterSettingsObject(input)
    expect(out).toEqual({ permissions: { allow: ['x'] }, theme: 'dark' })
  })
  it('preserves insertion order for stable canonicalization', () => {
    const input = { theme: 'dark', permissions: { allow: ['x'] } }
    const out = filterSettingsObject(input)
    expect(Object.keys(out)).toEqual(['theme', 'permissions'])
  })
  it('empty object stays empty', () => {
    expect(filterSettingsObject({})).toEqual({})
  })
  it('drops unknown keys conservatively', () => {
    const out = filterSettingsObject({ permissions: {}, unknownNewKey: 'bar' })
    expect(out).toEqual({ permissions: {} })
  })
})
