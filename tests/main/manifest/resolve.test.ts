import { describe, it, expect } from 'vitest'
import { resolveActiveEntries } from '../../../src/main/sync/manifest/resolve'
import type { Manifest } from '../../../src/main/sync/manifest/schema'

const manifest: Manifest = {
  version: 1,
  entries: [
    { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    { kind: 'file', id: 'claude-global:skills', surface: 'claude-global', category: 'skills' },
    { kind: 'capability', id: 'capability:plugins', capability: 'plugins', data: {} },
  ],
}

describe('resolveActiveEntries', () => {
  it('active = known AND activation=true; capability never active', () => {
    const { active, newEntryIds } = resolveActiveEntries(manifest, {
      activation: { 'claude-global:commands': true, 'claude-global:skills': false },
      knownEntryIds: ['claude-global:commands', 'claude-global:skills', 'capability:plugins'],
    })
    expect(active.map((e) => e.id)).toEqual(['claude-global:commands'])
    expect(newEntryIds).toEqual([])
  })
  it('new offered entry (not known) is opt-in: not active, listed in newEntryIds', () => {
    const { active, newEntryIds } = resolveActiveEntries(manifest, {
      activation: { 'claude-global:commands': true },
      knownEntryIds: ['claude-global:commands'],
    })
    expect(active.map((e) => e.id)).toEqual(['claude-global:commands'])
    expect(newEntryIds.sort()).toEqual(['capability:plugins', 'claude-global:skills'])
  })
  it('known but activation missing → treated as inactive', () => {
    const { active } = resolveActiveEntries(manifest, {
      activation: {},
      knownEntryIds: ['claude-global:commands'],
    })
    expect(active).toEqual([])
  })
})
