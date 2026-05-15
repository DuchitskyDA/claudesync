// src/main/sync/engine/rules.ts

/** Top-level entries within ~/.claude that are synced into the repo. */
export const CLAUDE_TOP_LEVEL_SYNC = new Set([
  'CLAUDE.md',
  'settings.json',
  'commands',
  'skills',
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

/** settings.json keys synced cross-machine. */
export const SETTINGS_KEY_ALLOW_LIST: ReadonlySet<string> = new Set([
  'permissions',
  'hooks',
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

export function isClaudePathSynced(relPath: string): boolean {
  if (isClaudePathIgnored(relPath)) return false
  const norm = relPath.replace(/\\/g, '/')
  const top = topSegment(norm)
  if (!CLAUDE_TOP_LEVEL_SYNC.has(top)) return false
  if (top === 'projects') {
    // require .../memory/...
    const parts = norm.split('/')
    return parts[2] === 'memory'
  }
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

/** Cursor sync paths inside a project root. */
export function isCursorPathSynced(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  if (IGNORE_NAME.test(basename(norm))) return false
  if (norm === '.cursorrules') return true
  if (norm.startsWith('.cursor/rules/')) return true
  if (norm.startsWith('.cursor/skills/')) return true
  return false
}
