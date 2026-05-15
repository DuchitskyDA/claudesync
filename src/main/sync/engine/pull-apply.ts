// src/main/sync/engine/pull-apply.ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SETTINGS_KEY_ALLOW_LIST } from './rules'

export async function applyToSource(absPath: string, content: Buffer | null): Promise<void> {
  if (content === null) {
    if (existsSync(absPath)) {
      try { unlinkSync(absPath) } catch { /* ignore */ }
    }
    return
  }
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content)
}

/**
 * Merge HEAD's blob into source-side settings.json:
 * - allow-list keys come from HEAD's blob (canonical content).
 * - everything else (env + volatile telemetry) is preserved from the source.
 * If allow-list key exists in source but NOT in HEAD's blob, it's removed
 * (means another machine intentionally removed it).
 */
export function mergeSettingsForPull(headBlob: Buffer, currentSrc: Buffer | null): Buffer {
  const newParsed = JSON.parse(headBlob.toString('utf8')) as Record<string, unknown>
  if (currentSrc === null) return headBlob
  let currentParsed: Record<string, unknown>
  try {
    currentParsed = JSON.parse(currentSrc.toString('utf8')) as Record<string, unknown>
  } catch {
    return headBlob
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
