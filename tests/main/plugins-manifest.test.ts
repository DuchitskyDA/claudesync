import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildManifest,
  manifestMissing,
  readMarketplaceRepos,
  readManifest,
  writeManifest,
  generateManifest,
} from '../../src/main/plugins-manifest'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-manifest-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('buildManifest', () => {
  it('attaches the marketplace repo and sorts ids', () => {
    const m = buildManifest(
      ['z@m1', 'a@m2'],
      { m1: 'org/one', m2: 'org/two' },
    )
    expect(m).toEqual({
      version: 1,
      plugins: [
        { id: 'a@m2', repo: 'org/two' },
        { id: 'z@m1', repo: 'org/one' },
      ],
    })
  })
  it('omits repo when the marketplace is unknown', () => {
    const m = buildManifest(['x@official'], {})
    expect(m.plugins).toEqual([{ id: 'x@official' }])
  })
})

describe('manifestMissing', () => {
  it('returns manifest ids absent from the installed set', () => {
    const m = buildManifest(['a@m', 'b@m', 'c@m'], {})
    expect(manifestMissing(m, ['b@m'])).toEqual(['a@m', 'c@m'])
  })
  it('null manifest → []', () => {
    expect(manifestMissing(null, ['a@m'])).toEqual([])
  })
})

describe('readMarketplaceRepos', () => {
  it('maps marketplace name → repo from known_marketplaces.json', () => {
    mkdirSync(join(dir, 'plugins'), { recursive: true })
    writeFileSync(join(dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({
      'm1': { source: { source: 'github', repo: 'org/one' }, installLocation: '/abs/x' },
      'm2': { source: { source: 'github', repo: 'org/two' } },
    }), 'utf8')
    expect(readMarketplaceRepos(dir)).toEqual({ m1: 'org/one', m2: 'org/two' })
  })
  it('returns {} when the file is absent', () => {
    expect(readMarketplaceRepos(dir)).toEqual({})
  })
})

describe('write/readManifest round-trip', () => {
  it('persists and reloads', () => {
    const m = buildManifest(['a@m'], { m: 'org/m' })
    writeManifest(dir, m)
    expect(readManifest(dir)).toEqual(m)
  })
  it('readManifest → null when absent', () => {
    expect(readManifest(dir)).toBeNull()
  })
})

describe('generateManifest', () => {
  it('composes from installed registry + marketplaces', () => {
    // installed registry
    const installPath = join(dir, 'plugins', 'cache', 'a')
    mkdirSync(installPath, { recursive: true })
    writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'super@obra': [{ installPath }] },
    }), 'utf8')
    writeFileSync(join(dir, 'plugins', 'known_marketplaces.json'), JSON.stringify({
      obra: { source: { source: 'github', repo: 'obra/superpowers-marketplace' } },
    }), 'utf8')
    expect(generateManifest(dir)).toEqual({
      version: 1,
      plugins: [{ id: 'super@obra', repo: 'obra/superpowers-marketplace' }],
    })
  })
})
