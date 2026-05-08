import { readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { AppConfig, LocalizedMessage } from '@shared/api'

/** Default rules target (~/.claude). Returns expanded path if dir exists; null otherwise. */
export function detectClaudeTarget(): string | null {
  const claudeDir = join(homedir(), '.claude')
  return existsSync(claudeDir) ? claudeDir : null
}

/** Suggested rules target path even if it doesn't exist yet — for placeholders. */
export function suggestedClaudeTargetPath(): string {
  return join(homedir(), '.claude')
}

/** Compute deterministic local repo path managed by app, given the URL. */
export function defaultManagedRepoPath(url: string, userDataDir: string): string {
  const sha = createHash('sha256').update(url).digest('hex').slice(0, 12)
  return join(userDataDir, 'repos', sha)
}

export function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export function readConfig(filePath: string): AppConfig {
  const fallback: AppConfig = {
    repoPath: null,
    repoUrl: null,
    rulesTarget: null,
    includeSecretsInPush: false,
    locale: null,
    lastDismissedUpdate: null,
  }
  if (!existsSync(filePath)) return fallback
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    const locale = parsed.locale === 'en' || parsed.locale === 'ru' ? parsed.locale : null
    return {
      repoPath: typeof parsed.repoPath === 'string' ? parsed.repoPath : null,
      repoUrl: typeof parsed.repoUrl === 'string' ? parsed.repoUrl : null,
      rulesTarget: typeof parsed.rulesTarget === 'string' ? parsed.rulesTarget : null,
      includeSecretsInPush: parsed.includeSecretsInPush === true,
      locale,
      lastDismissedUpdate:
        typeof parsed.lastDismissedUpdate === 'string' ? parsed.lastDismissedUpdate : null,
    }
  } catch {
    return fallback
  }
}

export function writeConfig(filePath: string, cfg: AppConfig): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

export type ValidationResult = { ok: true } | { ok: false; error: LocalizedMessage }

export function validateLocalRepo(p: string): ValidationResult {
  if (!p) return { ok: false, error: { key: 'config.error.localRepoRequired' } }
  const expanded = expandTilde(p)
  if (!isAbsolute(expanded)) return { ok: false, error: { key: 'config.error.localRepoAbsolute' } }
  if (!existsSync(expanded)) return { ok: true } // will be created by clone
  let st
  try { st = statSync(expanded) } catch (e) { return { ok: false, error: { key: 'config.error.localRepoStat', params: { reason: (e as Error).message }, fallback: (e as Error).message } } }
  if (!st.isDirectory()) return { ok: false, error: { key: 'config.error.localRepoNotDir' } }
  // Existing dir: must be empty OR be a git repo (have .git inside)
  const entries = readdirSync(expanded)
  if (entries.length === 0) return { ok: true }
  if (entries.includes('.git')) return { ok: true }
  return { ok: false, error: { key: 'config.error.localRepoNotEmpty' } }
}

const URL_RE = /^(https?:\/\/|git@)[\w\-.@:/~]+/i

export function validateRepoUrl(u: string): ValidationResult {
  if (!u) return { ok: false, error: { key: 'config.error.urlRequired' } }
  if (!URL_RE.test(u)) return { ok: false, error: { key: 'config.error.urlInvalid' } }
  return { ok: true }
}

export function validateRulesTarget(p: string): ValidationResult {
  if (!p) return { ok: false, error: { key: 'config.error.targetRequired' } }
  const expanded = expandTilde(p)
  if (!isAbsolute(expanded)) return { ok: false, error: { key: 'config.error.targetAbsolute' } }
  return { ok: true }
}
