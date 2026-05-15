import { rmSync } from 'node:fs'
import type { DiffEntry } from '@shared/sync-types'
import {
  readTreeIntoIndex, updateIndexAdd, updateIndexRemove, writeTree, commitTree,
  updateRef, revParse, hashObjectWrite, syncWtToHead,
} from './git-ops'

export type BuildArgs = {
  repoPath: string
  diffs: DiffEntry[]
  /** Returns canonical content for a source file, or null if not applicable (deletion). */
  sourceContent: (d: DiffEntry) => Buffer | null
  commitMessage: string
  indexFile: string
  /** Optional second parent for merge commits. */
  secondParent?: string | null
}

export async function buildAndCommitFromSource(args: BuildArgs): Promise<string> {
  const { repoPath, diffs, sourceContent, commitMessage, indexFile, secondParent } = args
  try {
    await readTreeIntoIndex(repoPath, 'HEAD', indexFile)
    for (const d of diffs) {
      if (d.status === 'deleted') {
        await updateIndexRemove(repoPath, indexFile, d.repoPath)
      } else if (d.status === 'added' || d.status === 'modified') {
        const buf = sourceContent(d)
        if (buf === null) throw new Error(`source content missing for ${d.repoPath}`)
        const sha = await hashObjectWrite(repoPath, buf)
        await updateIndexAdd(repoPath, indexFile, '100644', sha, d.repoPath)
      }
    }
    const tree = await writeTree(repoPath, indexFile)
    const headTree = await revParse(repoPath, 'HEAD^{tree}')
    if (tree === headTree && !secondParent) return await revParse(repoPath, 'HEAD')  // nothing
    const head = await revParse(repoPath, 'HEAD')
    const parents = secondParent ? [head, secondParent] : [head]
    const commit = await commitTree(repoPath, tree, parents, commitMessage)
    await updateRef(repoPath, 'refs/heads/main', commit)
    await syncWtToHead(repoPath)
    return commit
  } finally {
    try { rmSync(indexFile, { force: true }) } catch { /* ignore */ }
  }
}
