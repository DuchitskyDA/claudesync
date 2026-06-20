import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uvxCandidates, findUvxOnDisk } from '../../../src/main/mcp/runtime'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runtime-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('uvxCandidates', () => {
  it('win32: contains APPDATA/Python paths and .local/bin', () => {
    const list = uvxCandidates('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'C:\\Users\\u')
    expect(list).toContain(join('C:\\Users\\u\\AppData\\Roaming', 'Python', 'Python314', 'Scripts', 'uvx.exe'))
    expect(list).toContain(join('C:\\Users\\u', '.local', 'bin', 'uvx.exe'))
  })

  it('darwin: contains .local/bin and /opt/homebrew/bin', () => {
    const list = uvxCandidates('darwin', {}, '/Users/u')
    expect(list).toContain(join('/Users/u', '.local', 'bin', 'uvx'))
    expect(list).toContain('/opt/homebrew/bin/uvx')
  })
})

describe('findUvxOnDisk', () => {
  it('returns path to first existing file in candidates', () => {
    const realPath = join(dir, 'uvx-real')
    writeFileSync(realPath, '')
    const result = findUvxOnDisk([join(dir, 'nope'), realPath])
    expect(result).toBe(realPath)
  })

  it('returns null when no candidates exist', () => {
    const result = findUvxOnDisk([join(dir, 'nope1'), join(dir, 'nope2')])
    expect(result).toBeNull()
  })

  it('returns null for empty candidates array', () => {
    expect(findUvxOnDisk([])).toBeNull()
  })
})
