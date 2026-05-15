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
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ClaudeProject } from '@shared/api'
import { decodeClaudeProjectSegment, defaultClaudeProjectName } from './rules'

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
    const absPath = decodeClaudeProjectSegment(encoded)
    if (byPath.has(absPath)) continue
    // Skip when the decoded path obviously doesn't exist on this machine —
    // those are entries from old projects we shouldn't auto-register. The
    // user can still add them manually if they want.
    if (!existsSync(absPath)) continue
    let name = defaultClaudeProjectName(encoded)
    if (usedNames.has(name)) name = `${name}-${shortHash(absPath)}`
    usedNames.add(name)
    byPath.add(absPath)
    additions.push({ name, path: absPath })
  }

  return additions.length === 0 ? existing : [...existing, ...additions]
}
