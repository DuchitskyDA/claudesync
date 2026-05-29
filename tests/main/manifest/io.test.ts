import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readManifest, writeManifest } from '../../../src/main/sync/manifest/io'
import type { Manifest } from '../../../src/main/sync/manifest/schema'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-mio-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const m: Manifest = { version: 1, entries: [{ kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' }] }

describe('manifest io', () => {
  it('returns null when no manifest present', () => {
    expect(readManifest(dir)).toBeNull()
  })
  it('write → read round-trips', async () => {
    await writeManifest(dir, m)
    expect(readManifest(dir)).toEqual(m)
  })
  it('atomic write leaves no .tmp- residue', async () => {
    await writeManifest(dir, m)
    const csDir = join(dir, '.claudesync')
    expect(readdirSync(csDir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
  it('throws on broken manifest file (not silent null)', () => {
    mkdirSync(join(dir, '.claudesync'), { recursive: true })
    writeFileSync(join(dir, '.claudesync', 'manifest.json'), '{ broken')
    expect(() => readManifest(dir)).toThrow()
  })
})
