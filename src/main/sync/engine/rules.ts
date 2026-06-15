// src/main/sync/engine/rules.ts
import { join, resolve } from 'node:path'
import type { ClaudeGlobalSyncFlags } from '@shared/api'

/** Top-level entries within ~/.claude that are synced into the repo. */
export const CLAUDE_TOP_LEVEL_SYNC = new Set([
  'CLAUDE.md',
  'settings.json',
  'commands',
  'skills',
  'plugins.manifest.json', // gated by syncGlobal.plugins, see isClaudePathSynced
  'projects', // selectively — only <hash>/memory/, see isClaudePathSynced
])

/** Hardcoded ignore prefixes/exact names within ~/.claude. */
const CLAUDE_IGNORE_TOP = new Set([
  'plugins',
  'sessions',
  'cache',
  'history.jsonl',
  '.credentials.json',
  'settings.local.json',
  'ide',
  'statsig',
])

/** Volatile/OS-junk patterns ignored anywhere. */
const IGNORE_NAME = /\.backup\.\d|^\.DS_Store$|^Thumbs\.db$/i

/** settings.json keys synced cross-machine.
 *  NOTE: `hooks` is intentionally NOT here. Hook commands reference machine-
 *  specific absolute script paths (e.g. C:\Users\…\.claude\hooks\x.js) and the
 *  scripts themselves live under ~/.claude/hooks/ which isn't synced — so a
 *  synced `hooks` value is broken on every machine but the one that wrote it.
 *  Hooks stay local per machine, like `env`. */
export const SETTINGS_KEY_ALLOW_LIST: ReadonlySet<string> = new Set([
  'permissions',
  'mcpServers',
  'theme',
  'statusLine',
  'autoCompactEnabled',
  'includeCoAuthoredBy',
  'model',
  'outputStyle',
  'verbose',
  'cleanupPeriodDays',
  'forceLoginMethod',
  'awsAuthRefresh',
  'awsCredentialExport',
  'enableArchitectTool',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
  'apiKeyHelper',
  'additionalDirectories',
])

/** Volatile/secret keys explicitly ignored — kept for documentation. */
export const CLAUDE_TOP_LEVEL_IGNORE: ReadonlySet<string> = CLAUDE_IGNORE_TOP

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}

function topSegment(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.indexOf('/')
  return i < 0 ? norm : norm.slice(0, i)
}

export function isClaudePathIgnored(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  if (IGNORE_NAME.test(basename(norm))) return true
  const top = topSegment(norm)
  if (CLAUDE_IGNORE_TOP.has(top)) return true
  // projects/<hash>/sessions/* and projects/<hash>/*.jsonl
  if (top === 'projects') {
    const parts = norm.split('/')
    if (parts[2] === 'sessions') return true
    if (parts.length === 3 && parts[2]?.endsWith('.jsonl')) return true
  }
  return false
}

export function isClaudePathSynced(
  relPath: string,
  syncGlobal: ClaudeGlobalSyncFlags,
): boolean {
  if (isClaudePathIgnored(relPath)) return false
  const norm = relPath.replace(/\\/g, '/')
  const top = topSegment(norm)
  if (!CLAUDE_TOP_LEVEL_SYNC.has(top)) return false
  if (top === 'projects') {
    // require .../memory/... (not gated by syncGlobal)
    const parts = norm.split('/')
    return parts[2] === 'memory'
  }
  if (top === 'CLAUDE.md') return syncGlobal.claudeMd
  if (top === 'commands') return syncGlobal.commands
  if (top === 'skills') return syncGlobal.skills
  if (top === 'settings.json') return syncGlobal.settings
  if (top === 'plugins.manifest.json') return syncGlobal.plugins === true
  return true
}

/** Hardcoded ignore prefixes/exact names within <project>/.claude/. */
const PROJECT_DOTCLAUDE_IGNORE_TOP = new Set([
  ...CLAUDE_IGNORE_TOP,
  'worktrees',
  'scheduled_tasks.lock',
])

/** Top-level entries within <project>/.claude/ that are synced. */
const PROJECT_DOTCLAUDE_SYNC = new Set([
  'CLAUDE.md',
  'settings.json',
  'commands',
  'skills',
])

export function isProjectDotClaudePathSynced(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  if (IGNORE_NAME.test(basename(norm))) return false
  const top = topSegment(norm)
  if (PROJECT_DOTCLAUDE_IGNORE_TOP.has(top)) return false
  if (!PROJECT_DOTCLAUDE_SYNC.has(top)) return false
  return true
}

export function filterSettingsObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (SETTINGS_KEY_ALLOW_LIST.has(key)) {
      out[key] = obj[key]
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Claude per-project path normalization
//
// Claude Code stores per-project memory under ~/.claude/projects/<encoded>/...
// where <encoded> is the project's absolute path with separators replaced by
// '-' (and ':' on Windows, since the drive colon would be illegal in a name).
//
// Examples:
//   POSIX:    /Users/foo/myrepo            -> -Users-foo-myrepo
//   Windows:  C:\Users\Foo\bar             -> C--Users-Foo-bar
//
// We need to map <encoded> ↔ a stable cross-device <name> registered by the
// user. We do that by encoding each registered project's absolute path with
// the SAME rule and comparing. We never need to perfectly decode (which is
// ambiguous because directory names can also contain '-'), only to:
//   - encode forward for comparison,
//   - produce a best-effort decoded preview for the auto-detect UX.
// ---------------------------------------------------------------------------

/** Encode an absolute path the way Claude Code does for projects/<dir>. */
export function encodeClaudeProjectSegment(absPath: string): string {
  // Normalize Windows backslashes to forward slashes, then replace every
  // path-separator-ish character with '-'. The result has a leading '-' on
  // POSIX absolute paths (because they start with '/'), and starts with the
  // drive letter on Windows ('C--Users-...').
  const norm = absPath.replace(/\\/g, '/').replace(/:/g, '-')
  return norm.replace(/\//g, '-')
}

/** Best-effort decode for UX defaults. Ambiguous when directory names contain
 *  '-'; callers should treat the result as a *suggestion* and verify with the
 *  filesystem before relying on it. */
export function decodeClaudeProjectSegment(encoded: string): string {
  // Windows shape: '<Drive>--<rest>' where Drive is a single uppercase letter.
  const winMatch = encoded.match(/^([A-Za-z])--(.*)$/)
  if (winMatch) {
    const drive = winMatch[1]!
    const rest = winMatch[2]!.replace(/-/g, '\\')
    return `${drive}:\\${rest}`
  }
  // POSIX shape: leading '-' becomes '/'.
  if (encoded.startsWith('-')) {
    return '/' + encoded.slice(1).replace(/-/g, '/')
  }
  // Fallback: treat as-is.
  return encoded
}

/** Cheap default name for auto-detection: last `-`-separated chunk. */
export function defaultClaudeProjectName(encoded: string): string {
  const i = encoded.lastIndexOf('-')
  return i < 0 ? encoded : encoded.slice(i + 1)
}

/** Separator-normalized path equality (case-insensitive on Windows). */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const norm = (p: string): string => {
    const r = resolve(p).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
}

/** True when a registered project's own .claude dir IS the global ~/.claude
 *  (e.g. the project path is the home dir). Syncing such a project's .claude
 *  would duplicate the entire global config under projects/<name>/.claude/,
 *  so detection and the engine must skip it. */
export function projectDotClaudeIsGlobal(
  projectPath: string,
  claudePath: string | null | undefined,
): boolean {
  return samePath(join(projectPath, '.claude'), claudePath)
}

/** Cursor sync paths inside a project root. */
export function isCursorPathSynced(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  if (IGNORE_NAME.test(basename(norm))) return false
  if (norm === '.cursorrules') return true
  if (norm.startsWith('.cursor/rules/')) return true
  if (norm.startsWith('.cursor/skills/')) return true
  return false
}
