import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const FILE_NAME = 'github-credentials.bin'
const PLAINTEXT_PREFIX = 'plaintext:'

/**
 * In-memory cache of decrypted tokens, keyed by userDataDir.
 *
 * Why this exists: on macOS, `safeStorage` is backed by Keychain Services.
 * For ad-hoc-signed apps (which we are — the cask postflight runs
 * `codesign --force --deep --sign -`, producing a fresh anonymous identity
 * after every brew upgrade), the keychain item's ACL no longer matches the
 * running app's signature, so each `decryptString` call surfaces the system
 * "allow access?" password prompt. The renderer mounts and immediately
 * fires both `getAuthState` and `getSyncStatus`, each of which calls
 * `loadToken` independently → two prompts on every launch.
 *
 * Decrypting once per process and reusing the value cuts that down to a
 * single prompt. The cache is invalidated by `saveToken` / `deleteToken`,
 * and (for safety) decrypt failures are NOT cached — a transient keychain
 * hiccup shouldn't permanently brick the session.
 */
const cache = new Map<string, string>()

function tokenPath(userDataDir: string): string {
  return join(userDataDir, FILE_NAME)
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function saveToken(userDataDir: string, token: string): void {
  if (!encryptionAvailable()) {
    // Fallback: plaintext with marker. Less secure on Linux without keyring,
    // but better than throwing — user can still use the app.
    writeFileSync(tokenPath(userDataDir), PLAINTEXT_PREFIX + token, 'utf8')
  } else {
    const encrypted = safeStorage.encryptString(token)
    writeFileSync(tokenPath(userDataDir), encrypted)
  }
  cache.set(userDataDir, token)
}

export function loadToken(userDataDir: string): string | null {
  const cached = cache.get(userDataDir)
  if (cached !== undefined) return cached

  const path = tokenPath(userDataDir)
  if (!existsSync(path)) return null

  // Check for plaintext fallback marker first (works regardless of encryption availability)
  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.startsWith(PLAINTEXT_PREFIX)) {
      const tok = raw.slice(PLAINTEXT_PREFIX.length)
      cache.set(userDataDir, tok)
      return tok
    }
  } catch {
    // fall through to binary read
  }

  if (!encryptionAvailable()) return null

  try {
    const tok = safeStorage.decryptString(readFileSync(path))
    cache.set(userDataDir, tok)
    return tok
  } catch {
    // Don't cache failures — let the next call retry the keychain.
    return null
  }
}

export function deleteToken(userDataDir: string): void {
  const path = tokenPath(userDataDir)
  if (existsSync(path)) unlinkSync(path)
  cache.delete(userDataDir)
}

/** Test-only: drop the in-memory token cache so each test starts clean. */
export function _resetCache(): void {
  cache.clear()
}
