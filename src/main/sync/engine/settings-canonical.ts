import { filterSettingsObject } from './rules'

/**
 * Канонизация settings.json: parse → отфильтровать по allow-list → JSON.stringify(..., null, 2).
 * Идемпотентно. Без trailing newline (важно для round-trip с git index).
 */
export function canonicalizeSettings(raw: Buffer): Buffer {
  const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
  const filtered = filterSettingsObject(parsed)
  return Buffer.from(JSON.stringify(filtered, null, 2), 'utf8')
}

export function settingsContentForCompare(raw: Buffer | null): Buffer | null {
  if (raw === null) return null
  return canonicalizeSettings(raw)
}
