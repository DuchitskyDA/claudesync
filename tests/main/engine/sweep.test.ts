import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepEngineState } from '../../../src/main/sync/engine/sweep'
import { beginSnapshot } from '../../../src/main/sync/engine/safety-snapshot'

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

  it('sweepEngineState rotates old safety-snapshot sessions beyond MIN_KEEP', () => {
    // sweepSnapshots keeps at least 10 newest sessions; creates 11 old sessions so
    // the oldest one becomes a sweep candidate and gets deleted when > 30 days old.
    const gitDir = join(dir, '.git')
    mkdirSync(gitDir)
    const ud = join(dir, 'ud-snap')
    mkdirSync(ud, { recursive: true })
    const snapDir = join(ud, 'safety-snapshots')
    const dummyFile = join(ud, 'dummy.txt')
    writeFileSync(dummyFile, 'x')
    const thirtyOneDaysAgoSec = (Date.now() - 31 * 24 * 3600 * 1000) / 1000

    // Create 11 sessions; backdate all so the first one is > 30 days old
    const sessionDirs: string[] = []
    for (let i = 0; i < 11; i++) {
      // Stagger names by sleeping 1ms between — use fixed prefix to ensure ordering
      const sn = beginSnapshot(ud, `op${i}`)
      sn.preserve(dummyFile)
      sn.commit()
      const entries = readdirSync(snapDir).sort()
      sessionDirs.push(entries[entries.length - 1])
    }
    // Backdate all sessions to > 30 days ago; then the oldest (first) is a candidate
    for (const name of sessionDirs) {
      utimesSync(join(snapDir, name), thirtyOneDaysAgoSec, thirtyOneDaysAgoSec)
    }
    // Now bump the 10 newest so they appear < 30 days old (keep only sessionDirs[0] as old candidate)
    const nowSec = Date.now() / 1000
    for (let i = 1; i < sessionDirs.length; i++) {
      utimesSync(join(snapDir, sessionDirs[i]!), nowSec, nowSec)
    }

    sweepEngineState(dir, ud)
    // Oldest session (sessionDirs[0]) should be deleted
    expect(existsSync(join(snapDir, sessionDirs[0]!))).toBe(false)
    // The 10 newer ones should still exist
    for (let i = 1; i < sessionDirs.length; i++) {
      expect(existsSync(join(snapDir, sessionDirs[i]!))).toBe(true)
    }
  })
})
