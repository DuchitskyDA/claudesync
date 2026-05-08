import { describe, it, expect } from 'vitest'
import { pluralCategory } from '../../src/renderer/i18n/pluralize'

describe('pluralCategory', () => {
  it('EN — 1 → one, others → other', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 0)).toBe('other')
    expect(pluralCategory('en', 2)).toBe('other')
    expect(pluralCategory('en', 100)).toBe('other')
  })

  it('RU — covers one/few/many/other', () => {
    expect(pluralCategory('ru', 1)).toBe('one')
    expect(pluralCategory('ru', 21)).toBe('one')
    expect(pluralCategory('ru', 2)).toBe('few')
    expect(pluralCategory('ru', 22)).toBe('few')
    expect(pluralCategory('ru', 5)).toBe('many')
    expect(pluralCategory('ru', 11)).toBe('many')
    expect(pluralCategory('ru', 25)).toBe('many')
    expect(pluralCategory('ru', 1.5)).toBe('other')
  })

  it('coerces non-finite to other', () => {
    expect(pluralCategory('en', NaN)).toBe('other')
    expect(pluralCategory('ru', Infinity)).toBe('other')
  })
})
