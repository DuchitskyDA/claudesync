import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { createHash } from 'node:crypto'
import type { FileEntry } from '@shared/sync-types'
import type { ClaudeProject, ClaudeGlobalSyncFlags } from '@shared/api'
import {
  isClaudePathSynced,
  isClaudePathIgnored,
  isCursorPathSynced,
  isProjectDotClaudePathSynced,
  encodeClaudeProjectSegment,
} from './rules'
import { canonicalizeSettings } from './settings-canonical'

/** Build encoded→ClaudeProject lookup for fast translation while walking. */
function projectIndex(projects: ClaudeProject[]): Map<string, ClaudeProject> {
  const m = new Map<string, ClaudeProject>()
  for (const p of projects) m.set(encodeClaudeProjectSegment(p.path), p)
  return m
}

const MAX_BYTES = 5 * 1024 * 1024 // 5MB

function sha1OfBlob(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(content).digest('hex')
}

export type EnumResult = {
  entries: FileEntry[]
  /** repoPath's of files that exist on disk but couldn't be read/canonicalized
   *  or exceed MAX_BYTES. Never silently dropped → never inferred as deletion. */
  unreadable: string[]
  /** repoPath-prefixes whose directory could not be enumerated (readdir/lstat/
   *  stat failure). HEAD files under these prefixes must be treated as
   *  'unreadable', never 'deleted'. A trailing-slash entry covers a subtree;
   *  'claude/' covers the whole surface. */
  failed: string[]
}

function walk(
  rootAbs: string,
  prefixParts: string[],
  cb: (relPosix: string, abs: string) => void,
  failedRel: string[],
): void {
  if (!existsSync(rootAbs)) return // absent ≠ unreadable; caller decides
  let entries: string[]
  try { entries = readdirSync(rootAbs) } catch {
    failedRel.push(prefixParts.length ? posix.join(...prefixParts) : '')
    return
  }
  for (const name of entries) {
    const abs = join(rootAbs, name)
    let lst
    try { lst = lstatSync(abs) } catch { failedRel.push(posix.join(...prefixParts, name)); continue }
    if (lst.isSymbolicLink() && !existsSync(abs)) continue
    let st
    try { st = statSync(abs) } catch { failedRel.push(posix.join(...prefixParts, name)); continue }
    if (st.isDirectory()) {
      walk(abs, [...prefixParts, name], cb, failedRel)
    } else if (st.isFile()) {
      cb(posix.join(...prefixParts, name), abs)
    }
  }
}

/** Walks ~/.claude, returns synced file entries gated by syncGlobal. Per-project
 *  memory walks are gated by each project's `syncMemory` flag. */
export async function enumClaudeSource(
  claudePath: string,
  claudeProjects: ClaudeProject[] = [],
  syncGlobal: ClaudeGlobalSyncFlags = { claudeMd: true, commands: true, skills: true, settings: true },
): Promise<EnumResult> {
  if (!existsSync(claudePath)) return { entries: [], unreadable: [], failed: [] }
  const idx = projectIndex(claudeProjects)
  const out: FileEntry[] = []
  const unreadable: string[] = []

  // Resolve a disk-relative path to its repoPath, honoring memory translation.
  // Returns null when the path is outside the tracked set (e.g. unregistered
  // project or memory toggle off) — such paths are not tracked, so an
  // unreadable error on them is irrelevant.
  const toRepoRel = (rel: string): string | null => {
    const m = rel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
    if (m) {
      const proj = idx.get(m[1]!)
      if (!proj || !proj.syncMemory) return null
      return `projects/${proj.name}/${m[2]!}`
    }
    return rel
  }

  const failedRel: string[] = []
  walk(claudePath, [], (rel, abs) => {
    if (isClaudePathIgnored(rel)) return
    if (!isClaudePathSynced(rel, syncGlobal)) return
    const repoRel = toRepoRel(rel)
    if (repoRel === null) return // not tracked
    const repoPath = `claude/${repoRel}`
    let st
    try { st = statSync(abs) } catch { unreadable.push(repoPath); return }
    if (st.size > MAX_BYTES) { unreadable.push(repoPath); return }
    let content: Buffer
    try { content = readFileSync(abs) } catch { unreadable.push(repoPath); return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { unreadable.push(repoPath); return }
    }
    const sha1 = sha1OfBlob(content)
    out.push({ repoPath, surfacePath: rel, sha1, mode: '100644', size: content.length })
  }, failedRel)
  const failed: string[] = []
  for (const rel of failedRel) {
    if (rel === '') { failed.push('claude/'); continue }
    if (rel === 'projects') { failed.push('claude/projects/'); continue }
    const m = rel.match(/^projects\/([^/]+)(\/.*)?$/)
    if (m) {
      const proj = idx.get(m[1]!)
      if (!proj || !proj.syncMemory) continue // untracked subtree — irrelevant
      failed.push(`claude/projects/${proj.name}${m[2] ?? ''}`)
      continue
    }
    if (isClaudePathIgnored(rel)) continue
    failed.push(`claude/${rel}`)
  }
  return { entries: out, unreadable, failed }
}

/** Walks <project>/.claude/, returns synced file entries. Used when
 *  project.syncDotClaude=true. settings.json is canonicalized identically to
 *  the global one. */
export async function enumClaudeProjectDotClaudeSource(
  projectPath: string,
  projectName: string,
): Promise<EnumResult> {
  const root = join(projectPath, '.claude')
  if (!existsSync(root)) return { entries: [], unreadable: [], failed: [] }
  const out: FileEntry[] = []
  const unreadable: string[] = []
  const failedRel: string[] = []
  walk(root, [], (rel, abs) => {
    if (!isProjectDotClaudePathSynced(rel)) return
    const repoPath = `claude/projects/${projectName}/.claude/${rel}`
    let st
    try { st = statSync(abs) } catch { unreadable.push(repoPath); return }
    if (st.size > MAX_BYTES) { unreadable.push(repoPath); return }
    let content: Buffer
    try { content = readFileSync(abs) } catch { unreadable.push(repoPath); return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { unreadable.push(repoPath); return }
    }
    const sha1 = sha1OfBlob(content)
    out.push({ repoPath, surfacePath: `.claude/${rel}`, sha1, mode: '100644', size: content.length })
  }, failedRel)
  const failed: string[] = []
  for (const rel of failedRel) {
    if (rel === '') { failed.push(`claude/projects/${projectName}/.claude/`); continue }
    if (!isProjectDotClaudePathSynced(rel) && rel.includes('/')) continue // nested under ignored top
    failed.push(`claude/projects/${projectName}/.claude/${rel}`)
  }
  return { entries: out, unreadable, failed }
}

/** Walks a Cursor project root, returns synced .cursor/* + .cursorrules entries. */
export async function enumCursorProjectSource(projectPath: string, projectName: string): Promise<EnumResult> {
  if (!existsSync(projectPath)) return { entries: [], unreadable: [], failed: [] }
  const out: FileEntry[] = []
  const unreadable: string[] = []
  const failedRel: string[] = []
  walk(projectPath, [], (rel, abs) => {
    if (!isCursorPathSynced(rel)) return
    const repoPath = `cursor/projects/${projectName}/${rel}`
    let st
    try { st = statSync(abs) } catch { unreadable.push(repoPath); return }
    if (st.size > MAX_BYTES) { unreadable.push(repoPath); return }
    let content: Buffer
    try { content = readFileSync(abs) } catch { unreadable.push(repoPath); return }
    const sha1 = sha1OfBlob(content)
    out.push({ repoPath, surfacePath: rel, sha1, mode: '100644', size: content.length })
  }, failedRel)
  const failed: string[] = []
  for (const rel of failedRel) {
    if (rel === '') { failed.push(`cursor/projects/${projectName}/`); continue }
    failed.push(`cursor/projects/${projectName}/${rel}`)
  }
  return { entries: out, unreadable, failed }
}

/** True when repoPath is exactly a failed path or lies under a failed prefix. */
export function repoPathUnderFailed(repoPath: string, failed: string[]): boolean {
  return failed.some((f) => {
    if (f.endsWith('/')) return repoPath.startsWith(f)
    return repoPath === f || repoPath.startsWith(f + '/')
  })
}

/** Helper used by IndexBuilder: read raw bytes of a source file (with canonicalization for settings.json). */
export function readSourceForCommit(surfaceAbsPath: string, surfaceRelPath: string): Buffer {
  const raw = readFileSync(surfaceAbsPath)
  if (surfaceRelPath === 'settings.json' || surfaceRelPath === '.claude/settings.json') {
    return canonicalizeSettings(raw)
  }
  return raw
}
