import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig } from '../../src/main/config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readConfig', () => {
  it('returns {repoPath: null} when file does not exist', () => {
    expect(readConfig(join(dir, 'config.json'))).toEqual({ repoPath: null })
  })

  it('returns {repoPath: null} on invalid JSON', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '{not json')
    expect(readConfig(f)).toEqual({ repoPath: null })
  })

  it('reads valid config', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path' }))
    expect(readConfig(f)).toEqual({ repoPath: '/some/path' })
  })
})

describe('writeConfig', () => {
  it('writes JSON atomically (round-trip)', () => {
    const f = join(dir, 'config.json')
    writeConfig(f, { repoPath: '/abc' })
    expect(existsSync(f)).toBe(true)
    expect(readConfig(f)).toEqual({ repoPath: '/abc' })
  })
})
