import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyToSource, mergeSettingsForPull } from '../../../src/main/sync/engine/pull-apply'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-apply-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('mergeSettingsForPull returns null for unparseable current source (skip, not overwrite)', () => {
  const head = Buffer.from(JSON.stringify({ theme: 'light' }), 'utf8')
  expect(mergeSettingsForPull(head, Buffer.from('{ broken', 'utf8'))).toBeNull()
})

describe('applyToSource — atomic write', () => {
  it('writes full content and leaves no .tmp- residue', async () => {
    const target = join(dir, 'sub', 'file.txt')
    await applyToSource(target, Buffer.from('hello world'))
    expect(readFileSync(target, 'utf8')).toBe('hello world')
    expect(readdirSync(join(dir, 'sub')).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('overwrites existing file atomically', async () => {
    const target = join(dir, 'file.txt')
    writeFileSync(target, 'old')
    await applyToSource(target, Buffer.from('new'))
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('null content removes the file', async () => {
    const target = join(dir, 'file.txt')
    writeFileSync(target, 'x')
    await applyToSource(target, null)
    expect(readdirSync(dir)).toEqual([])
  })
})
