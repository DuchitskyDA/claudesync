import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '@shared/api'

export function readConfig(filePath: string): AppConfig {
  if (!existsSync(filePath)) return { repoPath: null }
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return { repoPath: typeof parsed.repoPath === 'string' ? parsed.repoPath : null }
  } catch {
    return { repoPath: null }
  }
}

export function writeConfig(filePath: string, cfg: AppConfig): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

export function validateRepoPath(p: string): ValidationResult {
  if (!existsSync(p)) return { ok: false, error: `Path not found: ${p}` }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(p)
  } catch (e) {
    return { ok: false, error: `Cannot stat path: ${(e as Error).message}` }
  }
  if (!st.isDirectory()) return { ok: false, error: `Not a directory: ${p}` }
  if (!existsSync(join(p, '.git'))) {
    return { ok: false, error: 'Folder is not a git repository (no .git inside)' }
  }
  if (!existsSync(join(p, 'install.sh')) && !existsSync(join(p, 'install.ps1'))) {
    return {
      ok: false,
      error: 'Repo has neither install.sh nor install.ps1 in root',
    }
  }
  return { ok: true }
}
