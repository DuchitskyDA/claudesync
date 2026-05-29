import { describe, it, expect } from 'vitest'
import { growManifest } from '../../../src/main/sync/manifest/grow'
import type { Manifest, ManifestEntry } from '../../../src/main/sync/manifest/schema'

const repo: Manifest = {
  version: 1,
  entries: [{ kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' }],
}

describe('growManifest', () => {
  it('adds active local entries missing from repo manifest', () => {
    const active: ManifestEntry[] = [
      { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
      { kind: 'file', id: 'project:erp:memory', surface: 'project', category: 'memory', project: 'erp' },
    ]
    const { manifest, addedIds } = growManifest(repo, active)
    expect(addedIds).toEqual(['project:erp:memory'])
    expect(manifest.entries.map((e) => e.id).sort()).toEqual(['claude-global:commands', 'project:erp:memory'])
  })
  it('is idempotent: no additions when all present', () => {
    const active: ManifestEntry[] = [
      { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    ]
    const { manifest, addedIds } = growManifest(repo, active)
    expect(addedIds).toEqual([])
    expect(manifest.entries).toEqual(repo.entries)
  })
  it('never removes existing repo entries', () => {
    const { manifest } = growManifest(repo, [])
    expect(manifest.entries.map((e) => e.id)).toContain('claude-global:commands')
  })
})
