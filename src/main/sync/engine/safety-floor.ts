// src/main/sync/engine/safety-floor.ts
import type { DiffEntry, SourceRef } from '@shared/sync-types'

export type FloorThresholds = { ratio: number; minAbs: number }

/** Default: a source is anomalous when it loses >=50% of its tracked files AND
 *  that's at least 5 files, OR when the whole source vanished (every tracked
 *  file deleted). Tuned to not trip on small intentional edits. */
export const DEFAULT_FLOOR_THRESHOLDS: FloorThresholds = { ratio: 0.5, minAbs: 5 }

export type FloorSourceVerdict = {
  source: SourceRef
  headCount: number
  deleting: number
  reason: 'source-empty' | 'ratio-exceeded'
}

export type FloorResult =
  | { ok: true }
  | { ok: false; blocked: FloorSourceVerdict[] }

/** Stable string key for a SourceRef. Mirrors the keying used in engine.ts. */
export function refKey(source: SourceRef): string {
  if (source.kind === 'claude-global') return 'claude-global'
  return `${source.kind}::${source.projectName}`
}

/**
 * Per-source mass-deletion guard. `headCountBySource` maps refKey(source) → number
 * of tracked files currently in HEAD for that source. Pure: no I/O.
 */
export function checkFloor(
  diffs: DiffEntry[],
  headCountBySource: Map<string, number>,
  thresholds: FloorThresholds,
): FloorResult {
  // Count deletions per source.
  const deletingBy = new Map<string, { source: SourceRef; count: number }>()
  for (const d of diffs) {
    if (d.status !== 'deleted') continue
    const key = refKey(d.source)
    const cur = deletingBy.get(key)
    if (cur) cur.count++
    else deletingBy.set(key, { source: d.source, count: 1 })
  }

  const blocked: FloorSourceVerdict[] = []
  for (const [key, { source, count }] of deletingBy) {
    const headCount = headCountBySource.get(key) ?? 0
    if (headCount < 1) continue // nothing tracked in HEAD — can't be a mass wipe
    if (count >= headCount) {
      // Whole source vanished.
      blocked.push({ source, headCount, deleting: count, reason: 'source-empty' })
      continue
    }
    if (count >= thresholds.minAbs && count / headCount >= thresholds.ratio) {
      blocked.push({ source, headCount, deleting: count, reason: 'ratio-exceeded' })
    }
  }

  return blocked.length === 0 ? { ok: true } : { ok: false, blocked }
}
