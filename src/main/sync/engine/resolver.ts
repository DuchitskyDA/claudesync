// src/main/sync/engine/resolver.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolverFile, ResolverState, SourceRef } from '@shared/sync-types'
import type { CursorProject } from '@shared/api'
import { refreshStatus } from './engine'
import { catFileBlob, mergeBase, revParse, readTreeMergeAggressive, updateIndexAdd, updateIndexRemove, writeTree, commitTree, updateRef, syncWtToHead, pushOrigin, hashObjectWrite, classifyRemoteError, lsTree } from './git-ops'
import { applyToSource, readSourceIfExists } from './pull-apply'
import { canonicalizeSettings } from './settings-canonical'

const STATE_FILE = 'sync-engine-resolve.json'

function stateFilePath(userDataDir: string): string {
  return join(userDataDir, STATE_FILE)
}

export function persistResolverState(userDataDir: string, state: ResolverState): void {
  mkdirSync(userDataDir, { recursive: true })
  const serializable = {
    ...state,
    files: state.files.map((f) => ({
      ...f,
      base: f.base ? f.base.toString('base64') : null,
      mine: f.mine ? f.mine.toString('base64') : null,
      theirs: f.theirs ? f.theirs.toString('base64') : null,
      editedContent: f.editedContent ? f.editedContent.toString('base64') : undefined,
    })),
  }
  writeFileSync(stateFilePath(userDataDir), JSON.stringify(serializable, null, 2), 'utf8')
}

export function loadResolverState(userDataDir: string): ResolverState | null {
  const fp = stateFilePath(userDataDir)
  if (!existsSync(fp)) return null
  const parsed = JSON.parse(readFileSync(fp, 'utf8')) as Record<string, unknown>
  const files = (parsed.files as Array<Record<string, unknown>>).map((f) => ({
    ...f,
    base: f.base ? Buffer.from(f.base as string, 'base64') : null,
    mine: f.mine ? Buffer.from(f.mine as string, 'base64') : null,
    theirs: f.theirs ? Buffer.from(f.theirs as string, 'base64') : null,
    editedContent: f.editedContent ? Buffer.from(f.editedContent as string, 'base64') : undefined,
  }))
  return {
    ...parsed,
    files,
  } as ResolverState
}

export function clearResolverState(userDataDir: string): void {
  try { rmSync(stateFilePath(userDataDir), { force: true }) } catch { /* ignore */ }
}

export type ResolverArgs = {
  repoPath: string
  claudePath: string | null
  cursorProjects: CursorProject[]
  token: string | null
  userDataDir: string
}

export async function computeResolverState(args: ResolverArgs): Promise<ResolverState> {
  const baseSha = await mergeBase(args.repoPath, 'HEAD', 'origin/main')
  const headSha = await revParse(args.repoPath, 'HEAD')
  const theirsSha = await revParse(args.repoPath, 'origin/main')

  // Union of paths from (source vs HEAD) and (HEAD vs origin/main)
  const status = await refreshStatus({ ...args, doFetch: false })
  const sourcePaths = new Set(status.diffs.filter((d) => d.status !== 'same').map((d) => d.repoPath))
  // HEAD vs origin/main
  const ours = await lsTree(args.repoPath, 'HEAD', 'claude/')
  const theirs = await lsTree(args.repoPath, 'origin/main', 'claude/')
  for (const proj of args.cursorProjects) {
    ours.push(...await lsTree(args.repoPath, 'HEAD', `cursor/projects/${proj.name}/`))
    theirs.push(...await lsTree(args.repoPath, 'origin/main', `cursor/projects/${proj.name}/`))
  }
  const oursByPath = new Map(ours.map((e) => [e.repoPath, e.sha]))
  const theirsByPath = new Map(theirs.map((e) => [e.repoPath, e.sha]))
  for (const p of new Set([...oursByPath.keys(), ...theirsByPath.keys()])) {
    if (oursByPath.get(p) !== theirsByPath.get(p)) sourcePaths.add(p)
  }

  const files: ResolverFile[] = []
  for (const repoPath of sourcePaths) {
    let source: SourceRef
    let surfaceAbs: string
    let surfacePath: string
    if (repoPath.startsWith('claude/')) {
      source = { kind: 'claude' }
      surfacePath = repoPath.slice('claude/'.length)
      surfaceAbs = join(args.claudePath ?? '', surfacePath)
    } else {
      const m = repoPath.match(/^cursor\/projects\/([^/]+)\/(.*)$/)
      if (!m) continue
      const projectName = m[1]!
      source = { kind: 'cursor-project', projectName }
      surfacePath = m[2]!
      const proj = args.cursorProjects.find((p) => p.name === projectName)
      if (!proj) continue  // project not registered locally — skip the row
      surfaceAbs = join(proj.path, surfacePath)
    }

    let base: Buffer | null = null
    let theirs: Buffer | null = null
    try {
      const baseTree = await lsTree(args.repoPath, baseSha, repoPath)
      if (baseTree.length > 0) base = await catFileBlob(args.repoPath, baseTree[0]!.sha)
    } catch { /* path didn't exist in base */ }
    try {
      const tTree = await lsTree(args.repoPath, 'origin/main', repoPath)
      if (tTree.length > 0) theirs = await catFileBlob(args.repoPath, tTree[0]!.sha)
    } catch { /* not in theirs */ }

    let mine = readSourceIfExists(surfaceAbs)
    if (mine && surfacePath === 'settings.json' && source.kind === 'claude') {
      try { mine = canonicalizeSettings(mine) } catch { /* leave raw */ }
    }

    files.push({ source, repoPath, surfacePath, base, mine, theirs, choice: null })
  }

  const state: ResolverState = { files, baseSha, headSha, theirsSha }
  persistResolverState(args.userDataDir, state)
  return state
}

export type ResolveExecuteArgs = ResolverArgs & {
  commitMessage: string
  resolutions: ResolverState
}

function finalContent(f: ResolverFile): Buffer | null {
  if (f.choice === 'mine') return f.mine
  if (f.choice === 'theirs') return f.theirs
  if (f.choice === 'manual') return f.editedContent ?? null
  return null
}

export async function executeResolve(args: ResolveExecuteArgs): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  const { repoPath, resolutions } = args
  const indexFile = join(repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`)
  try {
    // 1. Write source
    for (const f of resolutions.files) {
      const final = finalContent(f)
      const source = f.source
      let surfaceAbs: string | null
      if (source.kind === 'claude') {
        surfaceAbs = args.claudePath ? join(args.claudePath, f.surfacePath) : null
      } else {
        const proj = args.cursorProjects.find((p) => p.name === source.projectName)
        surfaceAbs = proj ? join(proj.path, f.surfacePath) : null
      }
      if (!surfaceAbs) continue  // unregistered project — skip writing to source
      await applyToSource(surfaceAbs, final)
    }

    // 2. Build merge commit
    await readTreeMergeAggressive(repoPath, resolutions.baseSha, resolutions.headSha, resolutions.theirsSha, indexFile)
    for (const f of resolutions.files) {
      const final = finalContent(f)
      if (final !== null) {
        const sha = await hashObjectWrite(repoPath, final)
        await updateIndexAdd(repoPath, indexFile, '100644', sha, f.repoPath)
      } else {
        await updateIndexRemove(repoPath, indexFile, f.repoPath)
      }
    }
    const tree = await writeTree(repoPath, indexFile)
    const commit = await commitTree(repoPath, tree, [resolutions.headSha, resolutions.theirsSha], args.commitMessage)
    await updateRef(repoPath, 'refs/heads/main', commit)
    await syncWtToHead(repoPath)

    const push = await pushOrigin(repoPath, 'main', args.token)
    if (!push.ok) {
      const kind = classifyRemoteError(push.stderr)
      return { kind: 'error', message: `push failed (${kind}): ${push.stderr}` }
    }
    clearResolverState(args.userDataDir)
    return { kind: 'ok' }
  } catch (e) {
    return { kind: 'error', message: (e as Error).message }
  } finally {
    try { rmSync(indexFile, { force: true }) } catch { /* ignore */ }
  }
}
