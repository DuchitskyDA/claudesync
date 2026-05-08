import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 256 * 1024
const KEEP_BYTES = 128 * 1024

let cachedPath: string | null = null

function logPath(): string {
  if (cachedPath) return cachedPath
  cachedPath = join(app.getPath('userData'), 'updater.log')
  return cachedPath
}

function rotateIfTooBig(path: string): void {
  try {
    const size = statSync(path).size
    if (size <= MAX_BYTES) return
    const buf = readFileSync(path)
    // Keep the tail; cut on the first newline so we don't start mid-line.
    const tail = buf.subarray(buf.length - KEEP_BYTES)
    const nl = tail.indexOf(0x0a)
    const trimmed = nl >= 0 ? tail.subarray(nl + 1) : tail
    writeFileSync(path, trimmed)
  } catch {
    // file missing or transient io error — caller will recreate on next append
  }
}

/**
 * Append a structured updater-diagnostic line to `userData/updater.log`.
 * Used by the updater path so that "I clicked Update and it did nothing useful"
 * bug reports come with a hint of what actually happened on the user's machine.
 *
 * Test seam: takes an explicit path override.
 */
export function logUpdater(
  category: string,
  message: string,
  extra?: Record<string, unknown>,
  override?: { path?: string },
): void {
  const path = override?.path ?? logPath()
  const ts = new Date().toISOString()
  const extraStr = extra && Object.keys(extra).length > 0 ? ' ' + JSON.stringify(extra) : ''
  const line = `[${ts}] [${category}] ${message}${extraStr}\n`
  try {
    rotateIfTooBig(path)
    appendFileSync(path, line)
  } catch {
    // Logging must never throw out of the updater path.
  }
}

/** Test-only: reset the cached log path so a fresh app.getPath() resolves on next call. */
export function _resetLogPathCache(): void {
  cachedPath = null
}
