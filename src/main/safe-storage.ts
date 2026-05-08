import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const FILE_NAME = 'github-credentials.bin'
const PLAINTEXT_PREFIX = 'plaintext:'

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
    return
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenPath(userDataDir), encrypted)
}

export function loadToken(userDataDir: string): string | null {
  const path = tokenPath(userDataDir)
  if (!existsSync(path)) return null

  // Check for plaintext fallback marker first (works regardless of encryption availability)
  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.startsWith(PLAINTEXT_PREFIX)) {
      return raw.slice(PLAINTEXT_PREFIX.length)
    }
  } catch {
    // fall through to binary read
  }

  if (!encryptionAvailable()) return null

  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    return null
  }
}

export function deleteToken(userDataDir: string): void {
  const path = tokenPath(userDataDir)
  if (existsSync(path)) unlinkSync(path)
}
