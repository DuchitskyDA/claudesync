// tests/main/engine/rules.test.ts
import { describe, it, expect } from 'vitest'
import {
  isClaudePathSynced,
  isClaudePathIgnored,
  filterSettingsObject,
  encodeClaudeProjectSegment,
  decodeClaudeProjectSegment,
  defaultClaudeProjectName,
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

describe('Claude project path encoding', () => {
  describe('encodeClaudeProjectSegment', () => {
    it('encodes POSIX absolute path with leading -', () => {
      expect(encodeClaudeProjectSegment('/Users/foo/myrepo')).toBe('-Users-foo-myrepo')
      expect(encodeClaudeProjectSegment('/home/dan/work/erp')).toBe('-home-dan-work-erp')
    })
    it('encodes Windows path: drive colon becomes - and backslashes become -', () => {
      expect(encodeClaudeProjectSegment('C:\\Users\\DanyaLera\\Documents\\claudesync'))
        .toBe('C--Users-DanyaLera-Documents-claudesync')
      expect(encodeClaudeProjectSegment('D:\\work\\erp')).toBe('D--work-erp')
    })
    it('encodes lowercase Windows drive letter as-is (matches Claude Code)', () => {
      expect(encodeClaudeProjectSegment('c:\\Users\\Foo\\bar')).toBe('c--Users-Foo-bar')
    })
    it('treats forward slashes in Windows-shaped paths uniformly', () => {
      // Some callers pass already-normalized paths with forward slashes.
      expect(encodeClaudeProjectSegment('C:/Users/Foo/bar')).toBe('C--Users-Foo-bar')
    })
  })

  describe('decodeClaudeProjectSegment', () => {
    it('decodes POSIX shape back to absolute path', () => {
      expect(decodeClaudeProjectSegment('-Users-foo-myrepo')).toBe('/Users/foo/myrepo')
    })
    it('decodes Windows shape back to drive-prefixed path', () => {
      expect(decodeClaudeProjectSegment('C--Users-DanyaLera-Documents-claudesync'))
        .toBe('C:\\Users\\DanyaLera\\Documents\\claudesync')
    })
    it('preserves lowercase drive letter', () => {
      expect(decodeClaudeProjectSegment('c--Users-Foo-bar')).toBe('c:\\Users\\Foo\\bar')
    })
  })

  describe('round-trip — what we actually rely on for cross-device matching', () => {
    // The contract that matters: encode(decode(x)) === x for any encoded
    // segment Claude Code may produce. We don't claim decode is unambiguous
    // — directory names with '-' will reconstruct wrong — but for the
    // common case the round-trip must hold so a path registered locally
    // can be re-encoded and compared against `~/.claude/projects/<encoded>`.
    const samples = [
      '-Users-foo-myrepo',
      '-home-dan-work-erp',
      'C--Users-DanyaLera-Documents-claudesync',
      'D--work-erp',
      'c--Users-Foo-bar',
    ]
    for (const enc of samples) {
      it(`encode(decode("${enc}")) === "${enc}"`, () => {
        expect(encodeClaudeProjectSegment(decodeClaudeProjectSegment(enc))).toBe(enc)
      })
    }
  })

  describe('defaultClaudeProjectName', () => {
    it('returns basename for typical encoded segments', () => {
      expect(defaultClaudeProjectName('-Users-foo-myrepo')).toBe('myrepo')
      expect(defaultClaudeProjectName('C--Users-DanyaLera-Documents-claudesync')).toBe('claudesync')
    })
    it('returns the whole string when no separator', () => {
      expect(defaultClaudeProjectName('abc')).toBe('abc')
    })
  })
})
