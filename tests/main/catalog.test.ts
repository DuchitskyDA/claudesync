import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PluginCatalog } from '../../src/shared/api'

// ---------------------------------------------------------------------------
// Hoist mocks before any imports that trigger module evaluation
// ---------------------------------------------------------------------------
const getPathMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
}))

// Replace global fetch with our mock
vi.stubGlobal('fetch', fetchMock)

import { fetchCatalog } from '../../src/main/catalog'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MOCK_CATALOG: PluginCatalog = {
  version: 1,
  plugins: [{ id: 'p1', name: 'Plugin 1', description: 'Test plugin' }],
  presets: [],
}

function makeFetchOk(catalog: PluginCatalog = MOCK_CATALOG) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(catalog),
  })
}

function makeFetchFail(message = 'Network error') {
  fetchMock.mockRejectedValueOnce(new Error(message))
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'catalog-test-'))
  getPathMock.mockReturnValue(tmpDir)
  fetchMock.mockReset()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('fetchCatalog', () => {
  it('happy path: fetches and returns catalog', async () => {
    makeFetchOk()
    const catalog = await fetchCatalog()
    expect(catalog).toEqual(MOCK_CATALOG)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('writes cache file after successful fetch', async () => {
    makeFetchOk()
    await fetchCatalog()

    const { existsSync, readFileSync } = await import('node:fs')
    const cachePath = join(tmpDir, 'plugin-catalog-cache.json')
    expect(existsSync(cachePath)).toBe(true)
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cached.catalog).toEqual(MOCK_CATALOG)
    expect(typeof cached.fetchedAt).toBe('number')
  })

  it('TTL freshness: returns cached value without fetching when within TTL', async () => {
    // First fetch to populate cache
    makeFetchOk()
    await fetchCatalog()
    fetchMock.mockReset()

    // Second call without force — should use cache, not fetch
    const catalog = await fetchCatalog()
    expect(catalog).toEqual(MOCK_CATALOG)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('TTL expired: refetches when cache is older than 24h', async () => {
    // Write a stale cache manually
    const { writeFileSync } = await import('node:fs')
    const stale: PluginCatalog = { version: 1, plugins: [], presets: [] }
    const cacheFile = {
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      catalog: stale,
    }
    writeFileSync(join(tmpDir, 'plugin-catalog-cache.json'), JSON.stringify(cacheFile), 'utf8')

    // Network returns fresh data
    makeFetchOk(MOCK_CATALOG)
    const catalog = await fetchCatalog()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(catalog).toEqual(MOCK_CATALOG)
  })

  it('force=true bypasses TTL and re-fetches', async () => {
    // Populate a fresh cache
    makeFetchOk()
    await fetchCatalog()
    fetchMock.mockReset()

    // Force refresh
    const fresh: PluginCatalog = { version: 1, plugins: [{ id: 'new', name: 'New', description: '' }], presets: [] }
    makeFetchOk(fresh)
    const catalog = await fetchCatalog({ force: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(catalog).toEqual(fresh)
  })

  it('network failure with stale cache returns stale catalog', async () => {
    // Write a stale cache
    const { writeFileSync } = await import('node:fs')
    const stale: PluginCatalog = { version: 1, plugins: [{ id: 'stale', name: 'Stale', description: '' }], presets: [] }
    const cacheFile = {
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000, // expired
      catalog: stale,
    }
    writeFileSync(join(tmpDir, 'plugin-catalog-cache.json'), JSON.stringify(cacheFile), 'utf8')

    makeFetchFail('Network down')
    const catalog = await fetchCatalog()

    expect(catalog).toEqual(stale)
  })

  it('network failure without cache throws', async () => {
    makeFetchFail('Network down')
    await expect(fetchCatalog()).rejects.toThrow('Network down')
  })
})
