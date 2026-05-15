// src/main/sync/engine/comparator.ts
import type { ClaudeProject } from '@shared/api'
import type { DiffEntry, FileEntry, SourceRef } from '@shared/sync-types'
import { encodeClaudeProjectSegment } from './rules'

type HeadLike = { repoPath: string; sha: string; mode: '100644' | '100755'; size: number }

/** Strip the source-prefix from a repoPath to recover the surface-local path.
 *  Used when the source side has no entry (deleted-in-source case) and we
 *  can't read surfacePath from FileEntry directly. For Claude projects we
 *  also swap the canonical `<name>` segment for the locally-encoded one so
 *  the caller can `join(claudePath, surfacePath)` directly. */
function deriveSurfacePath(
  source: SourceRef,
  repoPath: string,
  claudeProjects: ClaudeProject[],
): string {
  if (source.kind === 'claude') {
    const rel = repoPath.startsWith('claude/') ? repoPath.slice('claude/'.length) : repoPath
    const m = rel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
    if (!m) return rel
    const name = m[1]!
    const tail = m[2]!
    const proj = claudeProjects.find((p) => p.name === name)
    if (!proj) return rel // unmatched — caller should treat as skip via surfaceAbsPath
    return `projects/${encodeClaudeProjectSegment(proj.path)}/${tail}`
  }
  const prefix = `cursor/projects/${source.projectName}/`
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath
}

export function compare(
  source: SourceRef,
  src: FileEntry[],
  head: HeadLike[],
  claudeProjects: ClaudeProject[] = [],
): DiffEntry[] {
  const srcMap = new Map(src.map((e) => [e.repoPath, e]))
  const headMap = new Map(head.map((e) => [e.repoPath, e]))
  const allPaths = new Set([...srcMap.keys(), ...headMap.keys()])
  const out: DiffEntry[] = []
  for (const repoPath of allPaths) {
    const s = srcMap.get(repoPath)
    const h = headMap.get(repoPath)
    const surfacePath = s?.surfacePath ?? deriveSurfacePath(source, repoPath, claudeProjects)
    if (s && h) {
      out.push({
        source, repoPath, surfacePath,
        status: s.sha1 === h.sha ? 'same' : 'modified',
        sourceSha: s.sha1, headSha: h.sha,
      })
    } else if (s) {
      out.push({ source, repoPath, surfacePath, status: 'added', sourceSha: s.sha1 })
    } else if (h) {
      out.push({ source, repoPath, surfacePath, status: 'deleted', headSha: h.sha })
    }
  }
  // Stable order for UI
  out.sort((a, b) => a.repoPath.localeCompare(b.repoPath))
  return out
}
