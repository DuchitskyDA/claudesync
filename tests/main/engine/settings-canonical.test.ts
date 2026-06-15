import { describe, it, expect } from 'vitest'
import { canonicalizeSettings, settingsContentForCompare } from '../../../src/main/sync/engine/settings-canonical'

describe('canonicalizeSettings', () => {
  it('outputs 2-space JSON.stringify of allow-listed keys', () => {
    const input = Buffer.from('{"permissions":{"allow":["x"]},"numStartups":42,"theme":"dark"}', 'utf8')
    const out = canonicalizeSettings(input)
    expect(out.toString('utf8')).toBe('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  },\n  "theme": "dark"\n}')
  })
  it('idempotent — canonicalize(canonicalize(x)) == canonicalize(x)', () => {
    const input = Buffer.from('{"permissions":{},"numStartups":1}', 'utf8')
    const once = canonicalizeSettings(input)
    const twice = canonicalizeSettings(once)
    expect(twice.equals(once)).toBe(true)
  })
  it('returns empty object bytes when input has no allow-listed keys', () => {
    const input = Buffer.from('{"numStartups":42,"env":{"S":"x"}}', 'utf8')
    const out = canonicalizeSettings(input)
    expect(out.toString('utf8')).toBe('{}')
  })
  it('drops hooks — they are machine-specific (absolute script paths) and not synced', () => {
    const input = Buffer.from('{"permissions":{"allow":["x"]},"hooks":{"PreToolUse":[{"command":"node","args":["C:\\\\x.js"]}]}}', 'utf8')
    const out = canonicalizeSettings(input)
    const parsed = JSON.parse(out.toString('utf8'))
    expect(parsed.hooks).toBeUndefined()
    expect(parsed.permissions).toEqual({ allow: ['x'] })
  })
  it('throws on invalid JSON', () => {
    expect(() => canonicalizeSettings(Buffer.from('not json', 'utf8'))).toThrow()
  })
})

describe('settingsContentForCompare', () => {
  it('null on missing source returns null', () => {
    expect(settingsContentForCompare(null)).toBeNull()
  })
  it('returns canonical bytes for present source', () => {
    const input = Buffer.from('{"theme":"dark","numStartups":1}', 'utf8')
    const out = settingsContentForCompare(input)
    expect(out?.toString('utf8')).toBe('{\n  "theme": "dark"\n}')
  })
})
