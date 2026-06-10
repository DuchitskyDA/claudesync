import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beginSnapshot, sweepSnapshots } from '../../../src/main/sync/engine/safety-snapshot'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-snap-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('safety-snapshot', () => {
  it('preserve copies file content and records manifest with original path', () => {
    const ud = join(root, 'ud')
    const target = join(root, 'live', 'CLAUDE.md')
    mkdirSync(join(root, 'live'), { recursive: true })
    writeFileSync(target, 'precious')
    const s = beginSnapshot(ud, 'pull-apply')
    s.preserve(target)
    s.commit()
    const sessions = readdirSync(join(ud, 'safety-snapshots'))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toContain('pull-apply')
    const dir = join(ud, 'safety-snapshots', sessions[0]!)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.op).toBe('pull-apply')
    expect(manifest.done).toBe(true)
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0].original).toBe(target)
    expect(readFileSync(manifest.entries[0].stored, 'utf8')).toBe('precious')
  })

  it('preserve of a missing file is a no-op; empty session creates no dir', () => {
    const ud = join(root, 'ud')
    const s = beginSnapshot(ud, 'discard')
    s.preserve(join(root, 'nope.md'))
    s.commit()
    expect(existsSync(join(ud, 'safety-snapshots'))).toBe(false)
  })

  it('preserve throws when snapshot dir cannot be created (fail-closed)', () => {
    const ud = join(root, 'ud-file')
    writeFileSync(ud, 'i am a file, not a dir')
    const target = join(root, 'x.md')
    writeFileSync(target, 'x')
    const s = beginSnapshot(ud, 'op')
    expect(() => s.preserve(target)).toThrow()
  })

  it('sweep removes sessions older than 30 days but always keeps 10 newest', () => {
    const ud = join(root, 'ud')
    const base = join(ud, 'safety-snapshots')
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    for (let i = 0; i < 13; i++) {
      const dir = join(base, `2026-01-0${i < 9 ? i + 1 : 9}T00-00-0${i}-op${i}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'manifest.json'), '{}')
      utimesSync(dir, old, old)
    }
    sweepSnapshots(ud)
    const left = readdirSync(base)
    expect(left).toHaveLength(10)
  })

  it('sweep keeps young sessions regardless of count', () => {
    const ud = join(root, 'ud')
    const base = join(ud, 'safety-snapshots')
    for (let i = 0; i < 12; i++) {
      const dir = join(base, `2026-06-01T00-00-${String(i).padStart(2, '0')}-op`)
      mkdirSync(dir, { recursive: true })
    }
    sweepSnapshots(ud)
    expect(readdirSync(base)).toHaveLength(12)
  })
})
