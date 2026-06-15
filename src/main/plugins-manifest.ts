// src/main/plugins-manifest.ts
//
// A small, portable manifest of installed plugins — synced (when the user opts
// in) as ~/.claude/plugins.manifest.json so another machine can replicate the
// set via the `claude plugin` CLI. We deliberately do NOT sync the heavy
// ~/.claude/plugins/ dir: it's ~30MB of marketplace git clones + caches with
// machine-specific absolute paths that would never reconcile cross-machine.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { PluginManifest } from '@shared/api'
import { readInstalledPluginIds } from './plugins'

export const MANIFEST_FILENAME = 'plugins.manifest.json'

function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

function manifestPath(claudePath: string): string {
  return join(expandTilde(claudePath), MANIFEST_FILENAME)
}

/** marketplace name (`<plugin>@<marketplace>` → `<marketplace>`). */
function marketplaceOf(id: string): string {
  const i = id.lastIndexOf('@')
  return i < 0 ? '' : id.slice(i + 1)
}

// --- Pure transforms (testable) ---------------------------------------------

/** Build a manifest from installed ids, attaching each plugin's marketplace
 *  GitHub repo (from known_marketplaces) so the other machine can re-add the
 *  source before installing. Ids are sorted for a stable, diff-friendly file. */
export function buildManifest(
  installedIds: string[],
  repoByMarketplace: Record<string, string>,
): PluginManifest {
  const plugins = [...installedIds].sort().map((id) => {
    const repo = repoByMarketplace[marketplaceOf(id)]
    return repo ? { id, repo } : { id }
  })
  return { version: 1, plugins }
}

/** Manifest ids that are not in the locally-installed set. */
export function manifestMissing(manifest: PluginManifest | null, installedIds: string[]): string[] {
  if (!manifest) return []
  const have = new Set(installedIds)
  return manifest.plugins.map((p) => p.id).filter((id) => !have.has(id))
}

// --- IO ---------------------------------------------------------------------

/** marketplace name → GitHub repo, from ~/.claude/plugins/known_marketplaces.json. */
export function readMarketplaceRepos(claudePath: string): Record<string, string> {
  const p = join(expandTilde(claudePath), 'plugins', 'known_marketplaces.json')
  if (!existsSync(p)) return {}
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(p, 'utf8')) } catch { return {} }
  if (!parsed || typeof parsed !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) {
    const repo = (v as { source?: { repo?: unknown } } | null)?.source?.repo
    if (typeof repo === 'string') out[name] = repo
  }
  return out
}

/** Compose the current manifest from the real registry + marketplaces. */
export function generateManifest(claudePath: string): PluginManifest {
  const settingsPath = join(expandTilde(claudePath), 'settings.json')
  return buildManifest(readInstalledPluginIds(settingsPath), readMarketplaceRepos(claudePath))
}

export function readManifest(claudePath: string): PluginManifest | null {
  const p = manifestPath(claudePath)
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as PluginManifest
    if (!parsed || !Array.isArray(parsed.plugins)) return null
    return parsed
  } catch {
    return null
  }
}

/** Atomically write the manifest. */
export function writeManifest(claudePath: string, manifest: PluginManifest): void {
  const p = manifestPath(claudePath)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  renameSync(tmp, p)
}
