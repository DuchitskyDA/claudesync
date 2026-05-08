import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PluginCatalog } from '@shared/api'

const CATALOG_URL = 'https://raw.githubusercontent.com/DuchitskyDA/claudesync-plugins/main/index.json'
const TTL_MS = 24 * 60 * 60 * 1000

type CacheFile = { fetchedAt: number; catalog: PluginCatalog }

function cachePath(): string {
  return join(app.getPath('userData'), 'plugin-catalog-cache.json')
}

function readCache(): CacheFile | null {
  const p = cachePath()
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as CacheFile
  } catch {
    return null
  }
}

function writeCache(c: CacheFile): void {
  writeFileSync(cachePath(), JSON.stringify(c, null, 2), 'utf8')
}

export async function fetchCatalog(opts: { force?: boolean } = {}): Promise<PluginCatalog> {
  const cache = readCache()
  if (!opts.force && cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.catalog
  }
  try {
    const res = await fetch(CATALOG_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const catalog = (await res.json()) as PluginCatalog
    writeCache({ fetchedAt: Date.now(), catalog })
    return catalog
  } catch (e) {
    if (cache) return cache.catalog // fall back to stale cache
    throw e
  }
}
