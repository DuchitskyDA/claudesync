// tests/main/engine/pull-apply.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyToSource, mergeSettingsForPull } from '../../../src/main/sync/engine/pull-apply'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-pa-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('applyToSource', () => {
  it('writes new content to source path, creates parent dirs', async () => {
    const target = join(dir, 'claude', 'commands', 'new.md')
    await applyToSource(target, Buffer.from('hello', 'utf8'))
    expect(readFileSync(target, 'utf8')).toBe('hello')
  })
  it('overwrites existing content', async () => {
    const target = join(dir, 'a.txt')
    writeFileSync(target, 'old')
    await applyToSource(target, Buffer.from('new', 'utf8'))
    expect(readFileSync(target, 'utf8')).toBe('new')
  })
  it('null content deletes the file', async () => {
    const target = join(dir, 'a.txt')
    writeFileSync(target, 'doomed')
    await applyToSource(target, null)
    expect(existsSync(target)).toBe(false)
  })
  it('null content on missing file is no-op', async () => {
    const target = join(dir, 'never.txt')
    await applyToSource(target, null)
    expect(existsSync(target)).toBe(false)
  })
})

describe('mergeSettingsForPull', () => {
  it('takes allow-list keys from new blob, preserves env + volatile from current', () => {
    const headBlob = Buffer.from('{\n  "permissions": {\n    "allow": [\n      "y"\n    ]\n  }\n}', 'utf8')
    const currentSrc = Buffer.from('{"permissions":{"allow":["x"]},"numStartups":42,"env":{"K":"v"}}', 'utf8')
    const merged = mergeSettingsForPull(headBlob, currentSrc)
    const parsed = JSON.parse(merged.toString('utf8'))
    expect(parsed.permissions).toEqual({ allow: ['y'] })
    expect(parsed.numStartups).toBe(42)
    expect(parsed.env).toEqual({ K: 'v' })
  })
  it('removes allow-list key from src if absent in head', () => {
    const headBlob = Buffer.from('{}', 'utf8')
    const currentSrc = Buffer.from('{"permissions":{"allow":["x"]},"numStartups":1}', 'utf8')
    const merged = mergeSettingsForPull(headBlob, currentSrc)
    const parsed = JSON.parse(merged.toString('utf8'))
    expect(parsed.permissions).toBeUndefined()
    expect(parsed.numStartups).toBe(1)
  })
  it('when currentSrc absent, returns headBlob as-is', () => {
    const headBlob = Buffer.from('{\n  "theme": "dark"\n}', 'utf8')
    const merged = mergeSettingsForPull(headBlob, null)
    expect(merged.equals(headBlob)).toBe(true)
  })
})
