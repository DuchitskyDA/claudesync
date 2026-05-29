// src/main/sync/manifest/grow.ts
import type { Manifest, ManifestEntry } from './schema'

/**
 * Ensure every active local entry is offered in the repo manifest. Adds missing
 * ones (offered set only grows on push); never removes (removal is an explicit
 * separate action). Returns the (possibly unchanged) manifest and the ids added.
 */
export function growManifest(
  repoManifest: Manifest,
  activeLocalEntries: ManifestEntry[],
): { manifest: Manifest; addedIds: string[] } {
  const existing = new Set(repoManifest.entries.map((e) => e.id))
  const added = activeLocalEntries.filter((e) => !existing.has(e.id))
  if (added.length === 0) return { manifest: repoManifest, addedIds: [] }
  return {
    manifest: { version: 1, entries: [...repoManifest.entries, ...added] },
    addedIds: added.map((e) => e.id),
  }
}
