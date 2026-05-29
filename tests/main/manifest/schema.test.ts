import { describe, it, expect } from 'vitest'
import { parseManifest, serializeManifest, type Manifest } from '../../../src/main/sync/manifest/schema'

const sample: Manifest = {
  version: 1,
  entries: [
    { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    { kind: 'file', id: 'project:erp:memory', surface: 'project', category: 'memory', project: 'erp' },
    { kind: 'capability', id: 'capability:plugins', capability: 'plugins', data: { ids: ['x'] } },
  ],
}

describe('schema parse/serialize', () => {
  it('round-trips serialize → parse', () => {
    const buf = serializeManifest(sample)
    expect(parseManifest(buf)).toEqual(sample)
  })
  it('serialize is stable, pretty JSON ending with newline', () => {
    const text = serializeManifest(sample).toString('utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('"version": 1')
  })
  it('throws on invalid JSON', () => {
    expect(() => parseManifest(Buffer.from('{ not json'))).toThrow()
  })
  it('throws on missing/unknown version', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ entries: [] })))).toThrow(/version/i)
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 2, entries: [] })))).toThrow(/version/i)
  })
  it('throws on non-array entries', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 1, entries: {} })))).toThrow(/entries/i)
  })
  it('throws on entry with unknown kind', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 1, entries: [{ kind: 'bogus', id: 'x' }] })))).toThrow()
  })
  it('throws on file entry missing required fields', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 1, entries: [{ kind: 'file', id: 'x' }] })))).toThrow()
  })
})
