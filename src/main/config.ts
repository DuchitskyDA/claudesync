import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
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
