import { describe, it, expect } from 'vitest'
import { synthManifest, synthActivation } from '../../../src/main/sync/manifest/synth'
import type { ClaudeConfig } from '@shared/api'

const cfg: ClaudeConfig = {
  enabled: true, path: '/home/u/.claude',
  syncGlobal: { claudeMd: true, commands: false, skills: true, settings: true },
  projects: [
    { name: 'erp', path: '/p/erp', syncMemory: true, syncDotClaude: false },
    { name: 'crm', path: '/p/crm', syncMemory: false, syncDotClaude: true },
  ],
}

describe('synthManifest', () => {
  it('offers all 4 global categories + 2 per project (regardless of flags)', () => {
    const m = synthManifest(cfg)
    const ids = m.entries.map((e) => e.id).sort()
    expect(ids).toEqual([
      'claude-global:claudeMd', 'claude-global:commands', 'claude-global:settings', 'claude-global:skills',
      'project:crm:dotclaude', 'project:crm:memory',
      'project:erp:dotclaude', 'project:erp:memory',
    ])
    expect(m.version).toBe(1)
    expect(m.entries.every((e) => e.kind === 'file')).toBe(true)
  })
})

describe('synthActivation', () => {
  it('maps flags 1:1 to activation + lists all ids as known', () => {
    const { activation, knownEntryIds } = synthActivation(cfg)
    expect(activation).toEqual({
      'claude-global:claudeMd': true,
      'claude-global:commands': false,
      'claude-global:skills': true,
      'claude-global:settings': true,
      'project:erp:memory': true,
      'project:erp:dotclaude': false,
      'project:crm:memory': false,
      'project:crm:dotclaude': true,
    })
    expect(knownEntryIds.sort()).toEqual(Object.keys(activation).sort())
  })
})
