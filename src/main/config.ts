import { readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type {
  AppConfig,
  ClaudeConfig,
  ClaudeProject,
  CursorConfig,
  CursorProject,
  LocalizedMessage,
} from '@shared/api'

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

function defaultsBase(): AppConfig {
  return {
    repoPath: null,
    repoUrl: null,
    includeSecretsInPush: false,
    locale: null,
    lastDismissedUpdate: null,
    claude: {
      enabled: false,
      path: null,
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    },
    cursor: { enabled: false, projects: [] },
    catalogUrl: null,
    manifestActivation: {},
    knownEntryIds: [],
    rulesTarget: null,
  }
}

function readClaudeProjects(raw: unknown): ClaudeProject[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p): ClaudeProject[] => {
    if (
      p &&
      typeof p === 'object' &&
      typeof (p as { name?: unknown }).name === 'string' &&
      typeof (p as { path?: unknown }).path === 'string'
    ) {
      const obj = p as { name: string; path: string; syncMemory?: unknown; syncDotClaude?: unknown }
      return [{
        name: obj.name,
        path: obj.path,
        syncMemory: obj.syncMemory === false ? false : true,
        syncDotClaude: obj.syncDotClaude === false ? false : true,
      }]
    }
    return []
  })
}

function readSyncGlobal(raw: unknown): ClaudeConfig['syncGlobal'] {
  const def = { claudeMd: true, commands: true, skills: true, settings: true }
  if (!raw || typeof raw !== 'object') return def
  const r = raw as Record<string, unknown>
  return {
    claudeMd: r.claudeMd === false ? false : true,
    commands: r.commands === false ? false : true,
    skills: r.skills === false ? false : true,
    settings: r.settings === false ? false : true,
  }
}

function readManifestActivation(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

function readKnownEntryIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

function readClaudeBlock(parsed: Record<string, unknown>): ClaudeConfig {
  const block = parsed.claude
  if (block && typeof block === 'object' && 'enabled' in (block as object)) {
    const b = block as Record<string, unknown>
    return {
      enabled: b.enabled === true,
      path: typeof b.path === 'string' ? b.path : null,
      projects: readClaudeProjects(b.projects),
      syncGlobal: readSyncGlobal(b.syncGlobal),
    }
  }
  if (typeof parsed.rulesTarget === 'string') {
    return {
      enabled: true,
      path: parsed.rulesTarget,
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    }
  }
  return {
    enabled: false,
    path: null,
    projects: [],
    syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
  }
}

function readCursorBlock(parsed: Record<string, unknown>): CursorConfig {
  const block = parsed.cursor
  if (block && typeof block === 'object' && 'enabled' in (block as object)) {
    const b = block as Record<string, unknown>
    const projects: CursorProject[] = Array.isArray(b.projects)
      ? b.projects.flatMap((p): CursorProject[] => {
          if (
            p &&
            typeof p === 'object' &&
            typeof (p as { name?: unknown }).name === 'string' &&
            typeof (p as { path?: unknown }).path === 'string'
          ) {
            return [{ name: (p as { name: string }).name, path: (p as { path: string }).path }]
          }
          return []
        })
      : []
    return { enabled: b.enabled === true, projects }
  }
  return { enabled: false, projects: [] }
}

export function readConfig(filePath: string): AppConfig {
  if (!existsSync(filePath)) return { ...defaultsBase() }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return { ...defaultsBase() }
  }
  const locale = parsed.locale === 'en' || parsed.locale === 'ru' ? parsed.locale : null
  const claude = readClaudeBlock(parsed)
  return {
    repoPath: typeof parsed.repoPath === 'string' ? parsed.repoPath : null,
    repoUrl: typeof parsed.repoUrl === 'string' ? parsed.repoUrl : null,
    includeSecretsInPush: parsed.includeSecretsInPush === true,
    locale,
    lastDismissedUpdate:
      typeof parsed.lastDismissedUpdate === 'string' ? parsed.lastDismissedUpdate : null,
    claude,
    cursor: readCursorBlock(parsed),
    catalogUrl:
      typeof parsed.catalogUrl === 'string' && parsed.catalogUrl.trim() !== ''
        ? parsed.catalogUrl
        : null,
    manifestActivation: readManifestActivation(parsed.manifestActivation),
    knownEntryIds: readKnownEntryIds(parsed.knownEntryIds),
    // Transitional shim: mirror claude.path into rulesTarget so callers that
    // still read `cfg.rulesTarget` keep working until Tasks 2/4/5 land.
    // writeConfig drops this on save.
    rulesTarget: claude.path,
  }
}

export function writeConfig(filePath: string, cfg: AppConfig): void {
  const tmp = `${filePath}.tmp`
  const persisted: Omit<AppConfig, 'rulesTarget'> = {
    repoPath: cfg.repoPath,
    repoUrl: cfg.repoUrl,
    includeSecretsInPush: cfg.includeSecretsInPush,
    locale: cfg.locale,
    lastDismissedUpdate: cfg.lastDismissedUpdate,
    claude: cfg.claude,
    cursor: cfg.cursor,
    catalogUrl: cfg.catalogUrl,
    manifestActivation: cfg.manifestActivation,
    knownEntryIds: cfg.knownEntryIds,
  }
  writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf8')
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

const HTTP_URL_RE = /^https?:\/\/[\w\-.@:/~%]+\.[\w\-.@:/~%]+/i

/**
 * Validate a custom plugin-catalog URL. Empty / null is OK — that signals
 * "use the bundled default" and the fetcher takes the hardcoded path.
 */
export function validateCatalogUrl(u: string | null): ValidationResult {
  if (u === null || u.trim() === '') return { ok: true }
  if (!HTTP_URL_RE.test(u)) return { ok: false, error: { key: 'config.error.catalogUrlInvalid' } }
  return { ok: true }
}

export function validateClaudePath(p: string | null): ValidationResult {
  if (!p) return { ok: false, error: { key: 'config.error.targetRequired' } }
  const expanded = expandTilde(p)
  if (!isAbsolute(expanded)) return { ok: false, error: { key: 'config.error.targetAbsolute' } }
  return { ok: true }
}

/** @deprecated use validateClaudePath. Kept for backwards-compat callers. */
export const validateRulesTarget = (p: string): ValidationResult => validateClaudePath(p)

const INVALID_NAME_CHARS = /[<>:"/\\|?*]/

export function validateCursorProject(
  p: { name: string; path: string },
): ValidationResult {
  const name = p.name
  if (!name || !name.trim()) {
    return { ok: false, error: { key: 'cursor.error.nameRequired' } }
  }
  if (name === '.' || name === '..') {
    return { ok: false, error: { key: 'cursor.error.nameReserved' } }
  }
  if (INVALID_NAME_CHARS.test(name) || name.trim() !== name) {
    return { ok: false, error: { key: 'cursor.error.nameInvalid' } }
  }
  if (!p.path) {
    return { ok: false, error: { key: 'cursor.error.pathRequired' } }
  }
  const expanded = expandTilde(p.path)
  if (!isAbsolute(expanded)) {
    return { ok: false, error: { key: 'cursor.error.pathAbsolute' } }
  }
  if (!existsSync(expanded)) {
    return { ok: false, error: { key: 'cursor.error.pathMissing' } }
  }
  try {
    if (!statSync(expanded).isDirectory()) {
      return { ok: false, error: { key: 'cursor.error.pathNotDir' } }
    }
  } catch (e) {
    return {
      ok: false,
      error: { key: 'cursor.error.pathStat', fallback: (e as Error).message },
    }
  }
  return { ok: true }
}
