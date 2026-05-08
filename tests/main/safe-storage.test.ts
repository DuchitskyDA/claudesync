import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const encryptStringMock = vi.hoisted(() => vi.fn((s: string) => Buffer.from('enc:' + s)))
const decryptStringMock = vi.hoisted(() => vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')))

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: encryptStringMock,
    decryptString: decryptStringMock,
    isEncryptionAvailable: () => true,
  },
}))

import { saveToken, loadToken, deleteToken } from '../../src/main/safe-storage'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-token-'))
  encryptStringMock.mockClear()
  decryptStringMock.mockClear()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('safe-storage', () => {
  it('saveToken writes encrypted token to userData/github-credentials.bin', () => {
    saveToken(dir, 'gho_abc123')
    const path = join(dir, 'github-credentials.bin')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path).toString()).toBe('enc:gho_abc123')
    expect(encryptStringMock).toHaveBeenCalledWith('gho_abc123')
  })

  it('loadToken returns null when file missing', () => {
    expect(loadToken(dir)).toBeNull()
  })

  it('loadToken returns decrypted token round-trip', () => {
    saveToken(dir, 'gho_xyz')
    expect(loadToken(dir)).toBe('gho_xyz')
  })

  it('loadToken returns null on decrypt failure', () => {
    saveToken(dir, 'gho_xyz')
    decryptStringMock.mockImplementationOnce(() => {
      throw new Error('bad')
    })
    expect(loadToken(dir)).toBeNull()
  })

  it('deleteToken removes the file', () => {
    saveToken(dir, 'gho_xyz')
    deleteToken(dir)
    expect(existsSync(join(dir, 'github-credentials.bin'))).toBe(false)
  })

  it('deleteToken on missing file is a no-op', () => {
    expect(() => deleteToken(dir)).not.toThrow()
  })
})
