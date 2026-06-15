import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

import { validateClaudeTarget, settingsPathFor, getInstalled, applyChanges, readInstalledPluginIds } from '../../src/main/plugins'
import type { ApplyPluginChanges, PluginEntry } from '../../src/shared/api'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'plugins-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// validateClaudeTarget
// ---------------------------------------------------------------------------
describe('validateClaudeTarget', () => {
  it('returns ok:false when rulesTarget is null', () => {
    const r = validateClaudeTarget(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not configured/i)
  })

  it('returns ok:false for a relative path', () => {
    const r = validateClaudeTarget('relative/path')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/absolute/i)
  })

  it('returns ok:true with settingsPath for an absolute path', () => {
    const r = validateClaudeTarget(tmpDir)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.settingsPath).toBe(join(tmpDir, 'settings.json'))
  })

  it('expands ~ prefix and returns ok:true', () => {
    const r = validateClaudeTarget('~/.claude')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.settingsPath).toBe(join(homedir(), '.claude', 'settings.json'))
  })
})

// ---------------------------------------------------------------------------
// settingsPathFor
// ---------------------------------------------------------------------------
describe('settingsPathFor', () => {
  it('returns joined path with settings.json', () => {
    expect(settingsPathFor('/some/dir')).toBe(join('/some/dir', 'settings.json'))
  })

  it('expands ~ in path', () => {
    expect(settingsPathFor('~/.claude')).toBe(join(homedir(), '.claude', 'settings.json'))
  })
})

// ---------------------------------------------------------------------------
// getInstalled
// ---------------------------------------------------------------------------
describe('getInstalled', () => {
  it('returns empty state when settings file does not exist', () => {
    const sp = join(tmpDir, 'settings.json')
    const r = getInstalled(sp)
    expect(r).toEqual({ enabledIds: [], installedIds: [], envSet: [], knownMarketplaces: [], marketplaceSources: {} })
  })

  it('returns empty state when settings file is empty object', () => {
    const sp = join(tmpDir, 'settings.json')
    writeFileSync(sp, '{}', 'utf8')
    const r = getInstalled(sp)
    expect(r).toEqual({ enabledIds: [], installedIds: [], envSet: [], knownMarketplaces: [], marketplaceSources: {} })
  })

  it('returns only enabled=true plugin ids', () => {
    const sp = join(tmpDir, 'settings.json')
    writeFileSync(sp, JSON.stringify({
      enabledPlugins: { 'plugin-a': true, 'plugin-b': false, 'plugin-c': true },
    }), 'utf8')
    const r = getInstalled(sp)
    expect(r.enabledIds).toEqual(expect.arrayContaining(['plugin-a', 'plugin-c']))
    expect(r.enabledIds).not.toContain('plugin-b')
    expect(r.enabledIds).toHaveLength(2)
  })

  it('returns env keys and marketplace ids', () => {
    const sp = join(tmpDir, 'settings.json')
    writeFileSync(sp, JSON.stringify({
      enabledPlugins: {},
      env: { MY_KEY: 'val', OTHER: 'x' },
      extraKnownMarketplaces: { 'market-1': { source: { source: 'github', repo: 'a/b' } } },
    }), 'utf8')
    const r = getInstalled(sp)
    expect(r.envSet).toEqual(expect.arrayContaining(['MY_KEY', 'OTHER']))
    expect(r.knownMarketplaces).toEqual(['market-1'])
    expect(r.marketplaceSources).toEqual({ 'market-1': { source: 'github', repo: 'a/b' } })
  })

  it('round-trip via applyChanges includes marketplaceSources', () => {
    const sp = join(tmpDir, 'settings.json')
    // Write settings with a marketplace
    writeFileSync(sp, JSON.stringify({
      extraKnownMarketplaces: { 'mkt-x': { source: { source: 'github', repo: 'org/repo' } } },
    }), 'utf8')
    const r = getInstalled(sp)
    expect(r.marketplaceSources['mkt-x']).toEqual({ source: 'github', repo: 'org/repo' })
  })

  it('installedIds reflects the real registry, independent of enabledPlugins', () => {
    const sp = join(tmpDir, 'settings.json')
    // settings.json has NO enabledPlugins (the common real-world case)
    writeFileSync(sp, '{}', 'utf8')
    // …yet plugins are actually installed on disk
    const installPath = join(tmpDir, 'plugins', 'cache', 'sp', '5.0.7')
    mkdirSync(installPath, { recursive: true })
    writeFileSync(join(tmpDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'superpowers@claude-plugins-official': [{ installPath }] },
    }), 'utf8')
    const r = getInstalled(sp)
    expect(r.enabledIds).toEqual([])          // settings says nothing
    expect(r.installedIds).toEqual(['superpowers@claude-plugins-official']) // disk says installed
  })
})

// ---------------------------------------------------------------------------
// readInstalledPluginIds — real install detection from installed_plugins.json
// ---------------------------------------------------------------------------
describe('readInstalledPluginIds', () => {
  it('returns [] when registry is missing', () => {
    expect(readInstalledPluginIds(join(tmpDir, 'settings.json'))).toEqual([])
  })

  it('returns [] on malformed JSON', () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true })
    writeFileSync(join(tmpDir, 'plugins', 'installed_plugins.json'), '{ broken', 'utf8')
    expect(readInstalledPluginIds(join(tmpDir, 'settings.json'))).toEqual([])
  })

  it('includes an id only when its installPath exists on disk', () => {
    const sp = join(tmpDir, 'settings.json')
    const live = join(tmpDir, 'plugins', 'cache', 'live')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(tmpDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'live@mkt': [{ installPath: live }],
        'stale@mkt': [{ installPath: join(tmpDir, 'plugins', 'cache', 'gone') }],
      },
    }), 'utf8')
    const ids = readInstalledPluginIds(sp)
    expect(ids).toContain('live@mkt')
    expect(ids).not.toContain('stale@mkt')
  })
})

// ---------------------------------------------------------------------------
// applyChanges
// ---------------------------------------------------------------------------
describe('applyChanges', () => {
  const mkPlugin = (id: string, marketplace?: { id: string; repo: string }): PluginEntry => ({
    id,
    name: id,
    description: '',
    marketplace: marketplace
      ? { id: marketplace.id, source: { source: 'github', repo: marketplace.repo } }
      : undefined,
  })

  it('enable adds plugin to enabledPlugins', () => {
    const sp = join(tmpDir, 'settings.json')
    const changes: ApplyPluginChanges = {
      enable: [mkPlugin('my-plugin')],
      disable: [],
      envValues: {},
    }
    const r = applyChanges(sp, changes, tmpDir)
    expect(r.ok).toBe(true)

    const written = JSON.parse(readFileSync(sp, 'utf8')) as Record<string, unknown>
    expect((written.enabledPlugins as Record<string, boolean>)['my-plugin']).toBe(true)
  })

  it('enable with marketplace adds to extraKnownMarketplaces', () => {
    const sp = join(tmpDir, 'settings.json')
    const changes: ApplyPluginChanges = {
      enable: [mkPlugin('mp-plugin', { id: 'my-market', repo: 'org/repo' })],
      disable: [],
      envValues: {},
    }
    applyChanges(sp, changes, tmpDir)

    const written = JSON.parse(readFileSync(sp, 'utf8')) as Record<string, unknown>
    expect((written.enabledPlugins as Record<string, boolean>)['mp-plugin']).toBe(true)
    expect((written.extraKnownMarketplaces as Record<string, unknown>)['my-market']).toEqual({
      source: { source: 'github', repo: 'org/repo' },
    })
  })

  it('disable removes key from enabledPlugins', () => {
    const sp = join(tmpDir, 'settings.json')
    writeFileSync(sp, JSON.stringify({
      enabledPlugins: { 'plugin-a': true, 'plugin-b': true },
    }), 'utf8')

    const changes: ApplyPluginChanges = { enable: [], disable: ['plugin-a'], envValues: {} }
    const r = applyChanges(sp, changes, tmpDir)
    expect(r.ok).toBe(true)

    const written = JSON.parse(readFileSync(sp, 'utf8')) as Record<string, unknown>
    const enabled = written.enabledPlugins as Record<string, boolean>
    expect(enabled['plugin-a']).toBeUndefined()
    expect(enabled['plugin-b']).toBe(true)
  })

  it('merges envValues into env', () => {
    const sp = join(tmpDir, 'settings.json')
    writeFileSync(sp, JSON.stringify({ env: { EXISTING: 'old' } }), 'utf8')

    const changes: ApplyPluginChanges = {
      enable: [],
      disable: [],
      envValues: { NEW_KEY: 'new-value', EXISTING: 'updated' },
    }
    applyChanges(sp, changes, tmpDir)

    const written = JSON.parse(readFileSync(sp, 'utf8')) as Record<string, unknown>
    const env = written.env as Record<string, string>
    expect(env.EXISTING).toBe('updated')
    expect(env.NEW_KEY).toBe('new-value')
  })

  it('does not write empty string env values', () => {
    const sp = join(tmpDir, 'settings.json')
    const changes: ApplyPluginChanges = {
      enable: [],
      disable: [],
      envValues: { EMPTY_KEY: '' },
    }
    applyChanges(sp, changes, tmpDir)

    const written = JSON.parse(readFileSync(sp, 'utf8')) as Record<string, unknown>
    const env = written.env as Record<string, string> | undefined
    expect(env?.EMPTY_KEY).toBeUndefined()
  })

  it('does not touch other settings fields (permissions, effortLevel)', () => {
    const sp = join(tmpDir, 'settings.json')
    writeFileSync(sp, JSON.stringify({
      permissions: { allow: ['Bash'] },
      effortLevel: 'high',
      hooks: { PostToolUse: [] },
      enabledPlugins: {},
    }), 'utf8')

    const changes: ApplyPluginChanges = {
      enable: [mkPlugin('new-plugin')],
      disable: [],
      envValues: {},
    }
    applyChanges(sp, changes, tmpDir)

    const written = JSON.parse(readFileSync(sp, 'utf8')) as Record<string, unknown>
    expect(written.permissions).toEqual({ allow: ['Bash'] })
    expect(written.effortLevel).toBe('high')
    expect(written.hooks).toEqual({ PostToolUse: [] })
    expect((written.enabledPlugins as Record<string, boolean>)['new-plugin']).toBe(true)
  })

  it('atomic write round-trip: result can be read back correctly', () => {
    const sp = join(tmpDir, 'settings.json')
    const changes: ApplyPluginChanges = {
      enable: [mkPlugin('round-trip')],
      disable: [],
      envValues: { KEY: 'val' },
    }
    const r = applyChanges(sp, changes, tmpDir)
    expect(r.ok).toBe(true)

    // No .tmp file should remain
    expect(existsSync(`${sp}.tmp`)).toBe(false)

    // Read back via getInstalled
    const installed = getInstalled(sp)
    expect(installed.enabledIds).toContain('round-trip')
    expect(installed.envSet).toContain('KEY')
  })
})
