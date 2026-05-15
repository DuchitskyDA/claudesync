// src/main/sync/engine/head-enum.ts
import { lsTree } from './git-ops'
import type { FileEntry } from '@shared/sync-types'

/** Returns FileEntry-shaped list from HEAD under a repo prefix (e.g. 'claude/' or 'cursor/projects/Foo/'). */
export async function enumHead(repoPath: string, prefix: string, surfacePrefix: string): Promise<FileEntry[]> {
  const ls = await lsTree(repoPath, 'HEAD', prefix)
  return ls.map((e) => ({
    repoPath: e.repoPath,
    surfacePath: e.repoPath.startsWith(surfacePrefix) ? e.repoPath.slice(surfacePrefix.length) : e.repoPath,
    sha1: e.sha,
    mode: e.mode,
    size: e.size,
  }))
}
