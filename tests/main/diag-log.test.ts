import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logUpdater } from '../../src/main/diag-log'

let tmp: string
let logFile: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudesync-diag-'))
  logFile = join(tmp, 'updater.log')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('logUpdater', () => {
  it('appends a single line with timestamp, category, message', () => {
    logUpdater('brew', 'hello world', undefined, { path: logFile })
    const content = readFileSync(logFile, 'utf8')
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.Z-]+\] \[brew\] hello world\n$/)
  })

  it('serializes extra payload as JSON', () => {
    logUpdater('auto', 'event', { code: 0, version: '0.8.2' }, { path: logFile })
    const content = readFileSync(logFile, 'utf8')
    expect(content).toContain('[auto] event {"code":0,"version":"0.8.2"}')
  })

  it('appends multiple lines without overwriting', () => {
    logUpdater('a', 'one', undefined, { path: logFile })
    logUpdater('b', 'two', undefined, { path: logFile })
    const lines = readFileSync(logFile, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('[a] one')
    expect(lines[1]).toContain('[b] two')
  })

  it('rotates the file when it exceeds the cap, keeping the tail', () => {
    // Pre-seed a file larger than the 256 KB cap.
    const oldLine = 'OLD-LINE-PADDING-XYZ\n'
    const fillerLine = 'X'.repeat(200) + '\n'
    const filler = fillerLine.repeat(Math.ceil((300 * 1024) / fillerLine.length))
    writeFileSync(logFile, oldLine + filler)

    logUpdater('brew', 'fresh entry', undefined, { path: logFile })
    const content = readFileSync(logFile, 'utf8')

    // Pre-seed marker at the very top must have been trimmed away.
    expect(content.startsWith('OLD-LINE-PADDING')).toBe(false)
    expect(content).toContain('[brew] fresh entry')
    // After rotation we keep ~128 KB plus the new line.
    expect(content.length).toBeLessThan(160 * 1024)
  })

  it('never throws on bad path (silently swallows)', () => {
    // /dev/null/foo is unwriteable on macOS/Linux.
    expect(() =>
      logUpdater('x', 'no crash', undefined, { path: '/dev/null/cannot-write' }),
    ).not.toThrow()
    // Sanity: the bogus path must not exist as a regular file.
    expect(existsSync('/dev/null/cannot-write')).toBe(false)
  })
})
