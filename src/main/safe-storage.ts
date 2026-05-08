import { safeStorage } from 'electron'
import { chmodSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const FILE_NAME = 'github-credentials.bin'
const PLAINTEXT_PREFIX = 'plaintext:'

/**
 * In-memory cache of tokens, keyed by userDataDir. Avoids re-reading the
 * file on every IPC call from the renderer (mount-effect fires several
 * `loadToken` paths in parallel).
 *
 * Decrypt failures are NOT cached so a transient I/O hiccup doesn't brick
 * the session — the next call retries.
 */
const cache = new Map<string, string>()

/**
 * On macOS we deliberately do NOT use `safeStorage` (Keychain Services).
 *
 * The cask postflight ad-hoc-signs the .app with `codesign --force --deep
 * --sign -` after every brew upgrade. The Keychain item's ACL is bound to
 * the requesting binary's code signature; a fresh anonymous signature on
 * each upgrade means the ACL never matches and macOS surfaces the system
 * "allow access?" password prompt on every launch — even when the user
 * clicks "Always Allow", because the next signature differs again.
 *
 * Storing the OAuth token as plaintext with `chmod 0600` in the per-user
 * app-data dir trades opaque storage for prompt-free updates. Threat tier
 * matches `gh` CLI's `~/.config/gh/hosts.yml`, `git credential store`'s
 * `~/.git-credentials`, and any `.env` file: only readable by the owning
 * user account, scoped to `repo read:user`, no escalation path.
 *
 * Win/Linux still use `safeStorage` (DPAPI / libsecret) — those don't have
 * the prompt-on-resign problem, so encryption-at-rest is free there.
 */
function shouldUseKeychain(): boolean {
  if (process.platform === 'darwin') return false
  return encryptionAvailable()
}

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

function writePlaintext(path: string, token: string): void {
  writeFileSync(path, PLAINTEXT_PREFIX + token, 'utf8')
  try {
    chmodSync(path, 0o600)
  } catch {
    // Non-POSIX filesystem (rare on darwin/linux). The userData dir is
    // already user-private; this chmod is a defence-in-depth pass.
  }
}

export function saveToken(userDataDir: string, token: string): void {
  const path = tokenPath(userDataDir)
  if (shouldUseKeychain()) {
    const encrypted = safeStorage.encryptString(token)
    writeFileSync(path, encrypted)
  } else {
    writePlaintext(path, token)
  }
  cache.set(userDataDir, token)
}

export function loadToken(userDataDir: string): string | null {
  const cached = cache.get(userDataDir)
  if (cached !== undefined) return cached

  const path = tokenPath(userDataDir)
  if (!existsSync(path)) return null

  // Plaintext path: works regardless of platform / keychain availability,
  // and is the only path that ever runs on darwin for fresh installs.
  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.startsWith(PLAINTEXT_PREFIX)) {
      const tok = raw.slice(PLAINTEXT_PREFIX.length)
      cache.set(userDataDir, tok)
      return tok
    }
  } catch {
    // Binary file — fall through to encrypted read below.
  }

  if (!encryptionAvailable()) return null

  // Encrypted path: still here for Win/Linux fresh writes and for one-shot
  // migration of darwin users who upgraded from <0.8.9 (where we used to
  // encrypt). On darwin this is the LAST keychain prompt: we immediately
  // rewrite the file as plaintext so subsequent launches skip the keychain.
  try {
    const tok = safeStorage.decryptString(readFileSync(path))
    cache.set(userDataDir, tok)
    if (process.platform === 'darwin') {
      try {
        writePlaintext(path, tok)
      } catch {
        // Migration is best-effort; the in-memory cache still suppresses
        // further prompts for the rest of this process.
      }
    }
    return tok
  } catch {
    // Don't cache failures — let the next call retry.
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
