// src/main/sync/engine/comparator.ts
import type { DiffEntry, FileEntry, SourceRef } from '@shared/sync-types'

type HeadLike = { repoPath: string; sha: string; mode: '100644' | '100755'; size: number }

export function compare(source: SourceRef, src: FileEntry[], head: HeadLike[]): DiffEntry[] {
  const srcMap = new Map(src.map((e) => [e.repoPath, e]))
  const headMap = new Map(head.map((e) => [e.repoPath, e]))
  const allPaths = new Set([...srcMap.keys(), ...headMap.keys()])
  const out: DiffEntry[] = []
  for (const repoPath of allPaths) {
    const s = srcMap.get(repoPath)
    const h = headMap.get(repoPath)
    const surfacePath = s?.surfacePath ?? repoPath.split('/').slice(2).join('/')  // fallback for deleted
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
