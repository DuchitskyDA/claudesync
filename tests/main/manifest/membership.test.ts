import { describe, it, expect } from 'vitest'
import {
  globalPathCategory, entryId, hasActiveEntry,
} from '../../../src/main/sync/manifest/membership'
import type { ManifestEntry } from '../../../src/main/sync/manifest/schema'

describe('globalPathCategory', () => {
  it('maps top-level global paths', () => {
    expect(globalPathCategory('CLAUDE.md')).toBe('claudeMd')
    expect(globalPathCategory('settings.json')).toBe('settings')
    expect(globalPathCategory('commands/a.md')).toBe('commands')
    expect(globalPathCategory('commands/sub/b.md')).toBe('commands')
    expect(globalPathCategory('skills/foo/SKILL.md')).toBe('skills')
  })
  it('maps memory under projects/<encoded>/memory/', () => {
    expect(globalPathCategory('projects/-Users-x-erp/memory/note.md')).toBe('memory')
  })
  it('returns null for non-category paths', () => {
    expect(globalPathCategory('projects/-Users-x-erp/sessions/s.jsonl')).toBeNull()
    expect(globalPathCategory('random.txt')).toBeNull()
    expect(globalPathCategory('projects/-Users-x-erp/foo.jsonl')).toBeNull()
  })
})

describe('entryId', () => {
  it('global ids', () => {
    expect(entryId('claude-global', 'commands')).toBe('claude-global:commands')
  })
  it('project ids', () => {
    expect(entryId('project', 'memory', 'erp')).toBe('project:erp:memory')
    expect(entryId('project', 'dotclaude', 'erp')).toBe('project:erp:dotclaude')
  })
})

describe('hasActiveEntry', () => {
  const active: ManifestEntry[] = [
    { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    { kind: 'file', id: 'project:erp:memory', surface: 'project', category: 'memory', project: 'erp' },
  ]
  it('true when id present', () => {
    expect(hasActiveEntry('claude-global:commands', active)).toBe(true)
    expect(hasActiveEntry('project:erp:memory', active)).toBe(true)
  })
  it('false when absent', () => {
    expect(hasActiveEntry('claude-global:skills', active)).toBe(false)
    expect(hasActiveEntry('project:crm:memory', active)).toBe(false)
  })
})
