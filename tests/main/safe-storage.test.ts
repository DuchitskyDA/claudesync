import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
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

import { saveToken, loadToken, deleteToken, _resetCache } from '../../src/main/safe-storage'

let dir: string
const originalPlatform = process.platform

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-token-'))
  // mockReset (vs mockClear) drops any queued `mockImplementationOnce`
  // from a previous test — important here because `saveToken` now caches
  // and a queued one-shot impl can survive past the test that registered
  // it and fire in an unrelated test that finally calls the real decrypt.
  encryptStringMock.mockReset()
  encryptStringMock.mockImplementation((s: string) => Buffer.from('enc:' + s))
  decryptStringMock.mockReset()
  decryptStringMock.mockImplementation((b: Buffer) => b.toString().replace(/^enc:/, ''))
  isAvailableMock.mockReset()
  isAvailableMock.mockReturnValue(true)
  _resetCache()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  setPlatform(originalPlatform)
})

describe('safe-storage on macOS (no Keychain — plaintext + 0600)', () => {
  beforeEach(() => setPlatform('darwin'))

  it('saveToken writes plaintext and never invokes encryptString', () => {
    saveToken(dir, 'gho_abc123')
    const path = join(dir, 'github-credentials.bin')
    expect(readFileSync(path, 'utf8')).toBe('plaintext:gho_abc123')
    expect(encryptStringMock).not.toHaveBeenCalled()
  })

  it('saveToken sets file permissions to 0600', () => {
    saveToken(dir, 'gho_abc123')
    const path = join(dir, 'github-credentials.bin')
    const mode = statSync(path).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('loadToken returns the plaintext value without touching decryptString', () => {
    saveToken(dir, 'gho_abc123')
    _resetCache()
    expect(loadToken(dir)).toBe('gho_abc123')
    expect(decryptStringMock).not.toHaveBeenCalled()
  })

  it('migrates an existing encrypted file to plaintext on first read', () => {
    const path = join(dir, 'github-credentials.bin')
    // Simulate a file written by an older release (pre-0.8.9) that used
    // safeStorage on darwin: write encrypted bytes by hand.
    writeFileSync(path, Buffer.from('enc:gho_legacy'))

    expect(loadToken(dir)).toBe('gho_legacy')
    expect(decryptStringMock).toHaveBeenCalledTimes(1)
    // After load, the file must be rewritten as plaintext+0600 so the next
    // launch never has to talk to the keychain again.
    expect(readFileSync(path, 'utf8')).toBe('plaintext:gho_legacy')
    expect(statSync(path).mode & 0o777).toBe(0o600)

    // Subsequent load (cache cleared) reads plaintext directly.
    _resetCache()
    decryptStringMock.mockClear()
    expect(loadToken(dir)).toBe('gho_legacy')
    expect(decryptStringMock).not.toHaveBeenCalled()
  })

  it('deleteToken removes file and evicts cache', () => {
    saveToken(dir, 'gho_xyz')
    deleteToken(dir)
    expect(existsSync(join(dir, 'github-credentials.bin'))).toBe(false)
    expect(loadToken(dir)).toBeNull()
  })
})

describe('safe-storage on Windows / Linux (Keychain available — encrypted)', () => {
  beforeEach(() => setPlatform('win32'))

  it('saveToken encrypts via safeStorage', () => {
    saveToken(dir, 'gho_abc123')
    const path = join(dir, 'github-credentials.bin')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path).toString()).toBe('enc:gho_abc123')
    expect(encryptStringMock).toHaveBeenCalledWith('gho_abc123')
  })

  it('loadToken returns decrypted token round-trip', () => {
    saveToken(dir, 'gho_xyz')
    _resetCache()
    expect(loadToken(dir)).toBe('gho_xyz')
  })

  it('loadToken returns null on decrypt failure', () => {
    saveToken(dir, 'gho_xyz')
    _resetCache()
    decryptStringMock.mockImplementationOnce(() => {
      throw new Error('bad')
    })
    expect(loadToken(dir)).toBeNull()
  })

  it('does NOT migrate to plaintext (only darwin needs that)', () => {
    saveToken(dir, 'gho_xyz')
    _resetCache()
    expect(loadToken(dir)).toBe('gho_xyz')
    const path = join(dir, 'github-credentials.bin')
    expect(readFileSync(path).toString()).toBe('enc:gho_xyz')
  })

  it('falls back to plaintext when isEncryptionAvailable returns false (Linux without keyring)', () => {
    isAvailableMock.mockReturnValue(false)
    saveToken(dir, 'gho_fallback')
    const path = join(dir, 'github-credentials.bin')
    expect(readFileSync(path, 'utf8')).toBe('plaintext:gho_fallback')
  })
})

describe('safe-storage cache semantics (platform-independent)', () => {
  beforeEach(() => setPlatform('win32'))

  it('caches token across loadToken calls', () => {
    saveToken(dir, 'gho_xyz')
    decryptStringMock.mockClear()
    expect(loadToken(dir)).toBe('gho_xyz')
    expect(loadToken(dir)).toBe('gho_xyz')
    // saveToken populates cache directly — decryptString never called.
    expect(decryptStringMock).not.toHaveBeenCalled()
  })

  it('first loadToken from a fresh process decrypts exactly once', () => {
    saveToken(dir, 'gho_xyz')
    _resetCache()
    decryptStringMock.mockClear()
    expect(loadToken(dir)).toBe('gho_xyz')
    expect(loadToken(dir)).toBe('gho_xyz')
    expect(decryptStringMock).toHaveBeenCalledTimes(1)
  })

  it('saveToken refreshes cache so next loadToken returns the new value', () => {
    saveToken(dir, 'first')
    expect(loadToken(dir)).toBe('first')
    saveToken(dir, 'second')
    expect(loadToken(dir)).toBe('second')
  })

  it('loadToken returns null when file missing', () => {
    expect(loadToken(dir)).toBeNull()
  })

  it('deleteToken on missing file is a no-op', () => {
    expect(() => deleteToken(dir)).not.toThrow()
  })
})
