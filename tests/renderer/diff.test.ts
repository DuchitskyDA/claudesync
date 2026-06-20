import { describe, it, expect } from 'vitest'
import { lineDiff, isProbablyBinary } from '../../src/renderer/lib/diff'

const NUL = String.fromCharCode(0)
const REPLACEMENT = String.fromCharCode(0xfffd)

describe('lineDiff', () => {
  it('marks every line as context when both sides are identical', () => {
    const rows = lineDiff('a\nb\nc', 'a\nb\nc')
    expect(rows).toEqual([
      { type: 'context', text: 'a' },
      { type: 'context', text: 'b' },
      { type: 'context', text: 'c' },
    ])
  })

  it('marks added lines (present only in new)', () => {
    const rows = lineDiff('a\nc', 'a\nb\nc')
    expect(rows).toEqual([
      { type: 'context', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'context', text: 'c' },
    ])
  })

  it('marks deleted lines (present only in old)', () => {
    const rows = lineDiff('a\nb\nc', 'a\nc')
    expect(rows).toEqual([
      { type: 'context', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'context', text: 'c' },
    ])
  })

  it('represents a replacement as delete then add', () => {
    const rows = lineDiff('a\nx\nc', 'a\ny\nc')
    expect(rows).toEqual([
      { type: 'context', text: 'a' },
      { type: 'del', text: 'x' },
      { type: 'add', text: 'y' },
      { type: 'context', text: 'c' },
    ])
  })

  it('all-add when old is empty', () => {
    expect(lineDiff('', 'a\nb')).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ])
  })

  it('all-del when new is empty', () => {
    expect(lineDiff('a\nb', '')).toEqual([
      { type: 'del', text: 'a' },
      { type: 'del', text: 'b' },
    ])
  })

  it('returns nothing for two empty inputs', () => {
    expect(lineDiff('', '')).toEqual([])
  })
})

describe('isProbablyBinary', () => {
  it('is false for plain text', () => {
    expect(isProbablyBinary('hello\nworld')).toBe(false)
  })

  it('is true when a NUL byte is present', () => {
    expect(isProbablyBinary('he' + NUL + 'llo')).toBe(true)
  })

  it('is true when the unicode replacement char is present', () => {
    expect(isProbablyBinary('he' + REPLACEMENT + 'llo')).toBe(true)
  })
})
