import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const encryptStringMock = vi.hoisted(() => vi.fn((s: string) => Buffer.from('enc:' + s)))
const decryptStringMock = vi.hoisted(() => vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')))
const isAvailableMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: encryptStringMock,
    decryptString: decryptStringMock,
    isEncryptionAvailable: isAvailableMock,
  },
}))

import { saveToken, loadToken, deleteToken } from '../../src/main/safe-storage'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-token-'))
  encryptStringMock.mockClear()
  decryptStringMock.mockClear()
  isAvailableMock.mockClear()
  isAvailableMock.mockReturnValue(true)
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

describe('safe-storage with encryption unavailable', () => {
  it('saveToken falls back to plaintext when encryption unavailable', () => {
    isAvailableMock.mockReturnValue(false)
    saveToken(dir, 'gho_fallback')
    const path = join(dir, 'github-credentials.bin')
    expect(readFileSync(path, 'utf8')).toBe('plaintext:gho_fallback')
  })

  it('loadToken reads plaintext fallback', () => {
    writeFileSync(join(dir, 'github-credentials.bin'), 'plaintext:gho_x', 'utf8')
    expect(loadToken(dir)).toBe('gho_x')
  })

  it('loadToken returns null when encryption unavailable and no plaintext marker', () => {
    isAvailableMock.mockReturnValue(false)
    // write some non-plaintext bytes
    writeFileSync(join(dir, 'github-credentials.bin'), Buffer.from([0x00, 0x01]))
    expect(loadToken(dir)).toBeNull()
  })
})
