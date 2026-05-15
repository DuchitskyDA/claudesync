import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepEngineState } from '../../../src/main/sync/engine/sweep'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-sw-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('sweepEngineState', () => {
  it('removes tmp-index files older than 1h, keeps newer', () => {
    const gitDir = join(dir, '.git')
    mkdirSync(gitDir)
    const old = join(gitDir, 'tmp-index-1-1000'); writeFileSync(old, 'x')
    const recent = join(gitDir, 'tmp-index-2-2000'); writeFileSync(recent, 'y')
    // Backdate the old file by 2 hours
    const twoHoursAgoSec = (Date.now() - 2 * 3600 * 1000) / 1000
    utimesSync(old, twoHoursAgoSec, twoHoursAgoSec)
    sweepEngineState(dir, dir)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })

  it('is a no-op when .git does not exist', () => {
    expect(() => sweepEngineState(dir, dir)).not.toThrow()
  })

  it('leaves non-tmp-index files in .git alone', () => {
    const gitDir = join(dir, '.git')
    mkdirSync(gitDir)
    const config = join(gitDir, 'config')
    writeFileSync(config, '[core]')
    const twoHoursAgoSec = (Date.now() - 2 * 3600 * 1000) / 1000
    utimesSync(config, twoHoursAgoSec, twoHoursAgoSec)
    sweepEngineState(dir, dir)
    expect(existsSync(config)).toBe(true)
  })
})
