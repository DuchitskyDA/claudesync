export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

const cache = new Map<string, Intl.PluralRules>()

function getRules(locale: string): Intl.PluralRules {
  let r = cache.get(locale)
  if (!r) {
    r = new Intl.PluralRules(locale)
    cache.set(locale, r)
  }
  return r
}

export function pluralCategory(locale: string, count: number): PluralCategory {
  if (!Number.isFinite(count)) return 'other'
  return getRules(locale).select(count) as PluralCategory
}
