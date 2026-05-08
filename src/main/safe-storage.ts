import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const FILE_NAME = 'github-credentials.bin'

function tokenPath(userDataDir: string): string {
  return join(userDataDir, FILE_NAME)
}

export function saveToken(userDataDir: string, token: string): void {
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenPath(userDataDir), encrypted)
}

export function loadToken(userDataDir: string): string | null {
  const path = tokenPath(userDataDir)
  if (!existsSync(path)) return null
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
