import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { LocalizedMessage } from '@shared/api'
import { pluralCategory } from './pluralize'
import enDict from './locales/en.json'
import ruDict from './locales/ru.json'

export type Locale = 'en' | 'ru'
export const SUPPORTED: Locale[] = ['en', 'ru']

export type DictValue = string | { [category: string]: string }
export type Dict = Record<string, DictValue>
export type Dicts = Record<Locale, Dict>

export type TParams = Record<string, string | number>

function lookup(d: Dict, key: string): DictValue | undefined {
  return d[key]
}

function interpolate(template: string, params: TParams): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = params[k]
    return v == null ? '' : String(v)
  })
}

export function translate(
  locale: Locale,
  dicts: Dicts,
  key: string,
  params?: TParams,
): string {
  let raw: DictValue | undefined = lookup(dicts[locale] ?? {}, key)
  if (raw == null && locale !== 'en') raw = lookup(dicts.en ?? {}, key)
  if (raw == null) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      console.warn(`i18n miss: ${key}`)
    }
    return key
  }

  let str: string
  if (typeof raw === 'object') {
    const count = Number(params?.count ?? 0)
    const cat = pluralCategory(locale, count)
    str =
      raw[cat] ??
      raw.other ??
      raw[Object.keys(raw)[0] ?? ''] ??
      key
  } else {
    str = raw
  }
  return interpolate(str, params ?? {})
}

export function normalizeSystemLocale(raw: string | undefined): Locale {
  if (!raw) return 'en'
  if (raw.toLowerCase().startsWith('ru')) return 'ru'
  return 'en'
}

const dicts: Dicts = { en: enDict as Dict, ru: ruDict as Dict }

type LocaleContextValue = {
  locale: Locale
  preference: Locale | null
  setPreference: (p: Locale | null) => Promise<void>
  t: (key: string, params?: TParams) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)
LocaleContext.displayName = 'LocaleProvider'

export function LocaleProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [preference, setPreferenceState] = useState<Locale | null>(null)
  const [systemLocale, setSystemLocale] = useState<Locale>('en')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cfg = await window.api.getConfig()
      const sys = await window.api.getSystemLocale()
      if (cancelled) return
      setSystemLocale(normalizeSystemLocale(sys))
      setPreferenceState(cfg.locale)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const locale: Locale = preference ?? systemLocale

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      preference,
      setPreference: async (p) => {
        const cfg = await window.api.getConfig()
        const r = await window.api.setConfig({ ...cfg, locale: p })
        if (!r.ok) {
          const fallback = r.error?.fallback ?? r.error?.key ?? 'setConfig failed'
          throw new Error(fallback)
        }
        setPreferenceState(p)
      },
      t: (key, params) => translate(locale, dicts, key, params),
    }),
    [locale, preference],
  )

  if (!ready) return <></>
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useT(): (key: string, params?: TParams) => string {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useT must be used within <LocaleProvider>')
  return ctx.t
}

export function useLocale(): {
  locale: Locale
  preference: Locale | null
  setPreference: (p: Locale | null) => Promise<void>
} {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within <LocaleProvider>')
  const { locale, preference, setPreference } = ctx
  return { locale, preference, setPreference }
}

export function tMessage(
  t: (key: string, params?: TParams) => string,
  m: LocalizedMessage | undefined,
): string {
  if (m == null) return ''
  const translated = t(m.key, m.params)
  return translated === m.key && m.fallback ? m.fallback : translated
}
