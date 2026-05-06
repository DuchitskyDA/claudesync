import { readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import type { AppConfig } from '@shared/api'

export function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export function readConfig(filePath: string): AppConfig {
  if (!existsSync(filePath)) return { repoPath: null, repoUrl: null, rulesTarget: null }
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      repoPath: typeof parsed.repoPath === 'string' ? parsed.repoPath : null,
      repoUrl: typeof parsed.repoUrl === 'string' ? parsed.repoUrl : null,
      rulesTarget: typeof parsed.rulesTarget === 'string' ? parsed.rulesTarget : null,
    }
  } catch {
    return { repoPath: null, repoUrl: null, rulesTarget: null }
  }
}

export function writeConfig(filePath: string, cfg: AppConfig): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

export function validateLocalRepo(p: string): ValidationResult {
  if (!p) return { ok: false, error: 'Local repo path is required' }
  const expanded = expandTilde(p)
  if (!isAbsolute(expanded)) return { ok: false, error: 'Local repo path must be absolute' }
  if (!existsSync(expanded)) return { ok: true } // will be created by clone
  let st
  try { st = statSync(expanded) } catch (e) { return { ok: false, error: `Cannot stat: ${(e as Error).message}` } }
  if (!st.isDirectory()) return { ok: false, error: 'Local repo path must be a directory' }
  // Existing dir: must be empty OR be a git repo (have .git inside)
  const entries = readdirSync(expanded)
  if (entries.length === 0) return { ok: true }
  if (entries.includes('.git')) return { ok: true }
  return { ok: false, error: 'Folder is not empty and not a git repo — pick a fresh path or an existing clone' }
}

const URL_RE = /^(https?:\/\/|git@)[\w\-.@:/~]+/i

export function validateRepoUrl(u: string): ValidationResult {
  if (!u) return { ok: false, error: 'Repo URL is required' }
  if (!URL_RE.test(u)) return { ok: false, error: 'Invalid URL format (expected https:// or git@)' }
  return { ok: true }
}

export function validateRulesTarget(p: string): ValidationResult {
  if (!p) return { ok: false, error: 'Rules target folder is required' }
  const expanded = expandTilde(p)
  if (!isAbsolute(expanded)) return { ok: false, error: 'Rules target folder must be absolute' }
  return { ok: true }
}
