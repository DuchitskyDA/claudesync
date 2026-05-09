import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PluginCatalog } from '@shared/api'

/**
 * Built-in default catalog URL. Intentionally not surfaced in the Settings UI
 * (the input field shows blank when no override is set) — the goal is to keep
 * the default a private detail of the build, while still letting users plug
 * in their own catalog URL when they want to.
 *
 * Note: this URL is visible to anyone reading the source / bundled binary;
 * "hiding" here is UX-level only, not a security mechanism.
 */
const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/DuchitskyDA/claudesync-plugins/main/index.json'
const TTL_MS = 24 * 60 * 60 * 1000

type CacheFile = { fetchedAt: number; sourceUrl: string; catalog: PluginCatalog }

function cachePath(): string {
  return join(app.getPath('userData'), 'plugin-catalog-cache.json')
}

function readCache(): CacheFile | null {
  const p = cachePath()
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<CacheFile>
    if (typeof parsed.fetchedAt !== 'number' || !parsed.catalog) return null
    // Legacy caches (pre-catalogUrl) didn't store the source URL. Treat them
    // as bound to the bundled default — preserving the user's existing cache
    // across the upgrade so a fresh fetch isn't forced for no reason.
    const sourceUrl =
      typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : DEFAULT_CATALOG_URL
    return { fetchedAt: parsed.fetchedAt, sourceUrl, catalog: parsed.catalog }
  } catch {
    return null
  }
}

function writeCache(c: CacheFile): void {
  writeFileSync(cachePath(), JSON.stringify(c, null, 2), 'utf8')
}

function resolveUrl(override?: string | null): string {
  if (override && override.trim() !== '') return override
  return DEFAULT_CATALOG_URL
}

export type FetchCatalogOpts = {
  /** Bypass the 24h cache and refetch. */
  force?: boolean
  /** User-configured override URL. `null`/`undefined`/empty → bundled default. */
  catalogUrl?: string | null
}

export async function fetchCatalog(opts: FetchCatalogOpts = {}): Promise<PluginCatalog> {
  const url = resolveUrl(opts.catalogUrl)
  const cache = readCache()
  // Cache is keyed by source URL — switching to a custom URL must not return
  // the cached default-catalog entries (and vice versa).
  const cacheValid =
    cache && cache.sourceUrl === url && Date.now() - cache.fetchedAt < TTL_MS
  if (!opts.force && cacheValid) {
    return cache.catalog
  }
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const catalog = (await res.json()) as PluginCatalog
    writeCache({ fetchedAt: Date.now(), sourceUrl: url, catalog })
    return catalog
  } catch (e) {
    // Fall back to a stale cache only when it came from the same URL we just
    // tried — otherwise we'd silently show the wrong source's plugins.
    if (cache && cache.sourceUrl === url) return cache.catalog
    throw e
  }
}
