import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SETTINGS_KEY_ALLOW_LIST } from './rules'

let atomicCounter = 0

export async function applyToSource(absPath: string, content: Buffer | null): Promise<void> {
  if (content === null) {
    if (existsSync(absPath)) {
      try { unlinkSync(absPath) } catch { /* ignore */ }
    }
    return
  }
  mkdirSync(dirname(absPath), { recursive: true })
  // Atomic: write to a temp sibling, then rename over the target. rename within
  // the same directory is atomic on NTFS and POSIX — a crash never leaves a
  // half-written target.
  const tmp = `${absPath}.tmp-${process.pid}-${atomicCounter++}`
  try {
    writeFileSync(tmp, content)
    renameSync(tmp, absPath)
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
}

/**
 * Merge HEAD's blob into source-side settings.json:
 * - allow-list keys come from HEAD's blob (canonical content).
 * - everything else (env + volatile telemetry) is preserved from the source.
 * If allow-list key exists in source but NOT in HEAD's blob, it's removed
 * (means another machine intentionally removed it).
 *
 * Returns null when currentSrc is present but unparseable (e.g. truncated
 * mid-edit with env secrets). null means "skip this file" — callers must
 * never overwrite in this case; the file will sync once it becomes valid JSON.
 */
export function mergeSettingsForPull(headBlob: Buffer, currentSrc: Buffer | null): Buffer | null {
  const newParsed = JSON.parse(headBlob.toString('utf8')) as Record<string, unknown>
  if (currentSrc === null) return headBlob
  let currentParsed: Record<string, unknown>
  try {
    currentParsed = JSON.parse(currentSrc.toString('utf8')) as Record<string, unknown>
  } catch {
    // Local settings.json is unreadable mid-edit — overwriting it would
    // destroy env secrets and local edits. Skip; it syncs once it parses.
    return null
  }
  const result: Record<string, unknown> = { ...currentParsed }
  for (const key of SETTINGS_KEY_ALLOW_LIST) {
    if (key in newParsed) result[key] = newParsed[key]
    else delete result[key]
  }
  return Buffer.from(JSON.stringify(result, null, 2), 'utf8')
}

/** Read source content if exists, else null. */
export function readSourceIfExists(absPath: string): Buffer | null {
  if (!existsSync(absPath)) return null
  try { return readFileSync(absPath) } catch { return null }
}
