import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface McpServerCfg {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpServerResult {
  installed: boolean
  command: string | null
  args: string[]
  env: Record<string, string>
}

interface McpServerEntry {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

interface ProjectEntry {
  allowedTools: string[]
  mcpContextUris: string[]
  mcpServers: Record<string, McpServerEntry>
  enabledMcpjsonServers: string[]
  [key: string]: unknown
}

interface ClaudeJsonShape {
  projects?: Record<string, ProjectEntry>
  [key: string]: unknown
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Default path to ~/.claude.json */
export function claudeJsonPath(): string {
  return join(homedir(), '.claude.json')
}

/**
 * Soft read — returns {} on missing file or broken JSON.
 * Used only for read-only operations (list, get).
 */
function readClaudeJsonSoft(path: string): ClaudeJsonShape {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as ClaudeJsonShape
  } catch {
    return {}
  }
}

/**
 * Strict read — throws on broken JSON, returns {} on missing/empty file.
 * Used before any write operation so we never silently lose data.
 */
function readClaudeJsonStrict(path: string): ClaudeJsonShape {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw) return {}
  // Let JSON.parse throw naturally — caller catches it to preserve the file
  return JSON.parse(raw) as ClaudeJsonShape
}

/** Atomic write: write to .tmp then rename. */
function writeAtomically(path: string, data: ClaudeJsonShape): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

/**
 * Create a backup of the claude.json file in <homeDir>/.claude/backups/
 * Only called when the file actually exists.
 */
function makeBackup(path: string, resolvedHomeDir: string): void {
  const ts = new Date().toISOString().replace(/:/g, '-')
  const backupDir = join(resolvedHomeDir, '.claude', 'backups')
  mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, `claude.json.${ts}.backup`)
  copyFileSync(path, backupPath)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * List all project paths that have an entry in `projects{}`.
 * Returns [] when the file doesn't exist.
 */
export function listMcpProjects(path = claudeJsonPath()): string[] {
  const data = readClaudeJsonSoft(path)
  if (!data.projects || typeof data.projects !== 'object') return []
  return Object.keys(data.projects)
}

/**
 * Get the MCP server config for a given project+serverId.
 * Returns { installed: false, command: null, args: [], env: {} } when not found.
 */
export function getMcpServer(
  projectPath: string,
  serverId: string,
  path = claudeJsonPath(),
): McpServerResult {
  const notFound: McpServerResult = { installed: false, command: null, args: [], env: {} }
  const data = readClaudeJsonSoft(path)
  const project = data.projects?.[projectPath]
  if (!project) return notFound
  const server = project.mcpServers?.[serverId]
  if (!server) return notFound
  return {
    installed: true,
    command: server.command,
    args: server.args,
    env: server.env,
  }
}

/**
 * Add or replace an MCP server entry for a given project.
 * - Reads strictly (throws on broken JSON)
 * - Creates project defaults if missing
 * - Makes a backup (if file exists) before writing
 * - Writes atomically
 */
export function setMcpServer(
  projectPath: string,
  serverId: string,
  cfg: McpServerCfg,
  path = claudeJsonPath(),
  resolvedHomeDir?: string,
): void {
  // Strict read — throws if JSON is broken, preserving the file unchanged
  const data = readClaudeJsonStrict(path)

  // Ensure projects object exists
  if (!data.projects || typeof data.projects !== 'object') {
    data.projects = {}
  }

  // Ensure project entry exists with defaults
  const existing = data.projects[projectPath]
  const project: ProjectEntry = existing
    ? {
        ...existing,
        allowedTools: existing.allowedTools ?? [],
        mcpContextUris: existing.mcpContextUris ?? [],
        mcpServers: existing.mcpServers ?? {},
        enabledMcpjsonServers: existing.enabledMcpjsonServers ?? [],
      }
    : {
        allowedTools: [],
        mcpContextUris: [],
        mcpServers: {},
        enabledMcpjsonServers: [],
      }

  // Write the server entry
  project.mcpServers[serverId] = {
    type: 'stdio',
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
  }

  data.projects[projectPath] = project

  // Backup before writing (only if file exists)
  if (existsSync(path)) {
    makeBackup(path, resolvedHomeDir ?? homedir())
  }

  writeAtomically(path, data)
}

/**
 * Remove an MCP server entry from a project.
 * No-op (early return without writing) when project or server doesn't exist.
 * When something is removed, makes a backup then writes atomically.
 */
export function removeMcpServer(
  projectPath: string,
  serverId: string,
  path = claudeJsonPath(),
  resolvedHomeDir?: string,
): void {
  // Strict read — throws on broken JSON
  const data = readClaudeJsonStrict(path)

  const project = data.projects?.[projectPath]
  if (!project) return
  if (!project.mcpServers?.[serverId]) return

  delete project.mcpServers[serverId]

  // Backup before writing (file definitely exists at this point)
  makeBackup(path, resolvedHomeDir ?? homedir())

  writeAtomically(path, data)
}
