// src/main/sync/engine/claude-projects-detect.ts
//
// Auto-detection of claude-projects from the local ~/.claude/projects/ dir.
// We seed the registry on first launch (and on user-triggered re-scan) so the
// common case "just open the app and it syncs my projects" works without
// asking the user to register every directory manually.
//
// The function is additive only: it never modifies or removes entries the
// user has already registered (matched by absolute path or by name).

import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ClaudeProject } from '@shared/api'
import { projectDotClaudeIsGlobal } from './rules'

/** Find encoded project dirs under <claudePath>/projects/ that look like real
 *  Claude-Code projects. The signal is either a session log (`*.jsonl`) — Claude
 *  Code writes one per session — or a populated `memory/` directory. We can't
 *  rely on `memory/` alone: existing ClaudeSync installs leave a `memory`
 *  symlink behind, and if the symlink target is gone (renamed repo, deleted
 *  scratch dir) `statSync` throws ENOENT and the whole project disappears from
 *  detection. Returns the encoded segment list. */
function listLocalEncodedProjects(claudePath: string): string[] {
  const projectsDir = join(claudePath, 'projects')
  if (!existsSync(projectsDir)) return []
  let entries: string[]
  try { entries = readdirSync(projectsDir) } catch { return [] }
  const out: string[] = []
  for (const name of entries) {
    if (name === '.gitkeep') continue
    const projDir = join(projectsDir, name)
    let projSt
    try { projSt = statSync(projDir) } catch { continue }
    if (!projSt.isDirectory()) continue
    let projEntries: string[]
    try { projEntries = readdirSync(projDir) } catch { continue }
    const hasSession = projEntries.some((n) => n.endsWith('.jsonl'))
    let hasMemoryContent = false
    if (!hasSession && projEntries.includes('memory')) {
      try {
        const memEntries = readdirSync(join(projDir, 'memory'))
        hasMemoryContent = memEntries.length > 0
      } catch { /* broken symlink or unreadable — ignore */ }
    }
    if (!hasSession && !hasMemoryContent) continue
    out.push(name)
  }
  return out
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 4)
}

/** Recover the real on-disk absolute path from a Claude-Code-encoded project
 *  segment, probing the filesystem to disambiguate a literal '-' in a folder
 *  name from a path separator (the encoding is lossy — both map to '-').
 *  Returns null when nothing on this machine matches (e.g. a segment encoding
 *  another machine's path). */
export function resolveEncodedProjectPath(encoded: string): string | null {
  let root: string
  let rest: string
  const win = encoded.match(/^([A-Za-z])--(.*)$/)
  if (win) {
    root = `${win[1]}:\\`
    rest = win[2]!
  } else if (encoded.startsWith('-')) {
    root = '/'
    rest = encoded.slice(1)
  } else {
    return null
  }
  if (rest === '') return existsSync(root) ? root : null
  return probeSegments(root, rest.split('-'), 0)
}

/** Depth-first match of the remaining tokens against real directories under
 *  `dir`. Shortest candidate first → treat most '-' as separators (the common
 *  case), falling back to longer joins only when the short dir doesn't exist. */
function probeSegments(dir: string, tokens: string[], i: number): string | null {
  if (i === tokens.length) return existsSync(dir) ? dir : null
  for (let j = i; j < tokens.length; j++) {
    const child = join(dir, tokens.slice(i, j + 1).join('-'))
    if (!existsSync(child)) continue
    const found = probeSegments(child, tokens, j + 1)
    if (found !== null) return found
  }
  return null
}

/** Merge auto-detected projects into the existing registry. Returns the new
 *  list. Existing entries are preserved as-is; new entries are appended with
 *  basename-derived names, suffixed by a short path hash when the basename
 *  is already in use. */
export function detectClaudeProjects(
  claudePath: string,
  existing: ClaudeProject[],
): ClaudeProject[] {
  const encodedDirs = listLocalEncodedProjects(claudePath)
  const byPath = new Set(existing.map((p) => p.path))
  const usedNames = new Set(existing.map((p) => p.name))
  const additions: ClaudeProject[] = []

  for (const encoded of encodedDirs) {
    // Probe the filesystem to recover the real path — handles folder names
    // containing '-' (which the lossy encoding can't distinguish from a
    // separator) and naturally skips segments whose path isn't on this
    // machine (resolves to null). The user can still add those manually.
    const absPath = resolveEncodedProjectPath(encoded)
    if (absPath === null) continue
    // Skip a path whose .claude IS the global ~/.claude (e.g. the home dir) —
    // registering it would duplicate the entire global config on sync.
    if (projectDotClaudeIsGlobal(absPath, claudePath)) continue
    if (byPath.has(absPath)) continue
    let name = basename(absPath)
    if (usedNames.has(name)) name = `${name}-${shortHash(absPath)}`
    usedNames.add(name)
    byPath.add(absPath)
    additions.push({ name, path: absPath, syncMemory: true, syncDotClaude: false })
  }

  return additions.length === 0 ? existing : [...existing, ...additions]
}
