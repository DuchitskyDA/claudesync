import { describe, it, expect } from 'vitest'
import en from '../../src/renderer/i18n/locales/en.json'
import ru from '../../src/renderer/i18n/locales/ru.json'

const PLURAL_CATEGORIES_RU = ['one', 'few', 'many', 'other'] as const
const PLURAL_CATEGORIES_EN = ['one', 'other'] as const

function placeholders(s: string): string[] {
  const m = s.match(/\{\{(\w+)\}\}/g) ?? []
  return [...new Set(m)].sort()
}

function collectPlaceholders(value: unknown): string[] {
  if (typeof value === 'string') return placeholders(value)
  if (value && typeof value === 'object') {
    const set = new Set<string>()
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (typeof v === 'string') for (const p of placeholders(v)) set.add(p)
    }
    return [...set].sort()
  }
  return []
}

describe('dictionaries parity', () => {
  it('every EN key exists in RU', () => {
    const missing = Object.keys(en).filter((k) => !(k in ru))
    expect(missing).toEqual([])
  })

  it('every RU key exists in EN (no orphan RU keys)', () => {
    const missing = Object.keys(ru).filter((k) => !(k in en))
    expect(missing).toEqual([])
  })

  it('plural keys: EN has one+other, RU has one+few+many+other', () => {
    for (const [k, v] of Object.entries(en)) {
      if (typeof v !== 'object') continue
      for (const cat of PLURAL_CATEGORIES_EN) {
        expect(v, `EN[${k}] must have category ${cat}`).toHaveProperty(cat)
      }
      const ruVal = (ru as Record<string, unknown>)[k]
      expect(typeof ruVal, `RU[${k}] must also be a plural object`).toBe('object')
      for (const cat of PLURAL_CATEGORIES_RU) {
        expect(ruVal, `RU[${k}] must have category ${cat}`).toHaveProperty(cat)
      }
    }
  })

  it('placeholders match between EN and RU for each key', () => {
    for (const k of Object.keys(en)) {
      const enP = collectPlaceholders((en as Record<string, unknown>)[k])
      const ruP = collectPlaceholders((ru as Record<string, unknown>)[k])
      expect(ruP, `placeholders mismatch in key "${k}"`).toEqual(enP)
    }
  })
})
