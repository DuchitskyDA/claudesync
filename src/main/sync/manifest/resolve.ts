// src/main/sync/manifest/resolve.ts
import type { Manifest, ManifestEntry } from './schema'

export type DeviceManifestState = {
  activation: Record<string, boolean>
  knownEntryIds: string[]
}

/**
 * Resolve the effective active entries for this device.
 * - Only `file` entries can be active (capability has no executor in №2).
 * - An entry is active iff it is KNOWN (device has seen it) AND activation===true.
 * - Entries not in knownEntryIds are "new offered" → opt-in (not active),
 *   surfaced via newEntryIds so the UI can prompt.
 */
export function resolveActiveEntries(
  manifest: Manifest,
  state: DeviceManifestState,
): { active: ManifestEntry[]; newEntryIds: string[] } {
  const known = new Set(state.knownEntryIds)
  const active = manifest.entries.filter(
    (e) => e.kind === 'file' && known.has(e.id) && state.activation[e.id] === true,
  )
  const newEntryIds = manifest.entries.filter((e) => !known.has(e.id)).map((e) => e.id)
  return { active, newEntryIds }
}
