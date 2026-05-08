import { describe, it, expect } from 'vitest'
import { translate, normalizeSystemLocale, type Dicts } from '../../src/renderer/i18n'

const en = {
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'test.greeting': 'Hello, {{name}}',
  'test.files': { one: '{{count}} file', other: '{{count}} files' },
} as const

const ru = {
  'common.cancel': 'Отмена',
  'common.save': 'Сохранить',
  'test.greeting': 'Привет, {{name}}',
  'test.files': {
    one: '{{count}} файл',
    few: '{{count}} файла',
    many: '{{count}} файлов',
    other: '{{count}} файла',
  },
} as const

const dicts = { en, ru } as unknown as Dicts

describe('translate', () => {
  it('returns string for existing key', () => {
    expect(translate('en', dicts, 'common.cancel')).toBe('Cancel')
    expect(translate('ru', dicts, 'common.cancel')).toBe('Отмена')
  })

  it('interpolates {{var}} placeholders', () => {
    expect(translate('en', dicts, 'test.greeting', { name: 'Dan' })).toBe('Hello, Dan')
    expect(translate('ru', dicts, 'test.greeting', { name: 'Дан' })).toBe('Привет, Дан')
  })

  it('falls back to en when key missing in current locale', () => {
    const partial = { en: { 'only.in.en': 'EN value' }, ru: {} } as unknown as Dicts
    expect(translate('ru', partial, 'only.in.en')).toBe('EN value')
  })

  it('returns key as last resort when missing in both', () => {
    expect(translate('en', dicts, 'totally.missing.key')).toBe('totally.missing.key')
  })

  it('selects plural category by count', () => {
    expect(translate('en', dicts, 'test.files', { count: 1 })).toBe('1 file')
    expect(translate('en', dicts, 'test.files', { count: 5 })).toBe('5 files')
    expect(translate('ru', dicts, 'test.files', { count: 1 })).toBe('1 файл')
    expect(translate('ru', dicts, 'test.files', { count: 2 })).toBe('2 файла')
    expect(translate('ru', dicts, 'test.files', { count: 5 })).toBe('5 файлов')
  })

  it('plural falls back to other when category missing', () => {
    const partial = { en: { p: { other: 'X' } }, ru: {} } as unknown as Dicts
    expect(translate('en', partial, 'p', { count: 1 })).toBe('X')
  })

  it('missing param renders as empty string', () => {
    expect(translate('en', dicts, 'test.greeting')).toBe('Hello, ')
  })
})

describe('normalizeSystemLocale', () => {
  it('ru-* → ru', () => {
    expect(normalizeSystemLocale('ru')).toBe('ru')
    expect(normalizeSystemLocale('ru-RU')).toBe('ru')
    expect(normalizeSystemLocale('RU')).toBe('ru')
  })

  it('everything else → en', () => {
    expect(normalizeSystemLocale('en-US')).toBe('en')
    expect(normalizeSystemLocale('de')).toBe('en')
    expect(normalizeSystemLocale('')).toBe('en')
    expect(normalizeSystemLocale(undefined)).toBe('en')
  })
})
