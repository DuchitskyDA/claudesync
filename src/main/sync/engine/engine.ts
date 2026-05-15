import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CursorProject } from '@shared/api'
import type { EngineStatus, DiffEntry, SourceRef } from '@shared/sync-types'
import { enumClaudeSource, enumCursorProjectSource, readSourceForCommit } from './source-enum'
import { enumHead } from './head-enum'
import { compare } from './comparator'
import { fetchOrigin, revListCount, revParse, pushOrigin, updateRef, syncWtToHead, classifyRemoteError } from './git-ops'
import { buildAndCommitFromSource } from './index-builder'

export type RefreshArgs = {
  repoPath: string | null
  claudePath: string | null
  cursorProjects: CursorProject[]
  token: string | null
  doFetch?: boolean
}

const EMPTY_STATUS: EngineStatus = {
  state: 'no-remote', ahead: 0, behind: 0, localChanges: 0, diffs: [], fetchedAt: null,
}

export async function refreshStatus(args: RefreshArgs): Promise<EngineStatus> {
  const { repoPath, claudePath, cursorProjects, token } = args
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return EMPTY_STATUS

  const diffs: DiffEntry[] = []

  // Claude
  if (claudePath) {
    const src: SourceRef = { kind: 'claude' }
    const srcEntries = await enumClaudeSource(claudePath)
    const headEntries = await enumHead(repoPath, 'claude/', 'claude/')
    const part = compare(src, srcEntries, headEntries.map((h) => ({ ...h, sha: h.sha1 })))
    diffs.push(...part)
  }

  // Cursor projects
  for (const proj of cursorProjects) {
    const src: SourceRef = { kind: 'cursor-project', projectName: proj.name }
    const srcEntries = await enumCursorProjectSource(proj.path, proj.name)
    const headEntries = await enumHead(repoPath, `cursor/projects/${proj.name}/`, `cursor/projects/${proj.name}/`)
    const part = compare(src, srcEntries, headEntries.map((h) => ({ ...h, sha: h.sha1 })))
    diffs.push(...part)
  }

  const localChanges = diffs.filter((d) => d.status !== 'same').length

  // Remote
  let fetchedAt: number | null = null
  let offline = false
  if (args.doFetch === true) {
    const f = await fetchOrigin(repoPath, token)
    if (f.ok) fetchedAt = Date.now()
    else offline = true
  }

  let ahead = 0, behind = 0
  try {
    await revParse(repoPath, 'origin/main')
    ahead = await revListCount(repoPath, 'origin/main..HEAD')
    behind = await revListCount(repoPath, 'HEAD..origin/main')
  } catch {
    // no upstream — leave 0
  }

  let state: EngineStatus['state']
  if (offline) state = 'offline'
  else if (behind > 0 && localChanges > 0) state = 'diverged'
  else if (behind > 0) state = 'behind'
  // local-changes takes priority over ahead — uncommitted source changes are the
  // user's immediate concern; ahead (committed-but-unpushed) is included implicitly
  // because both states show the Push button (App.tsx).
  else if (localChanges > 0) state = 'local-changes'
  else if (ahead > 0) state = 'ahead'
  else state = 'in-sync'

  return { state, ahead, behind, localChanges, diffs, fetchedAt }
}

export type PushPreview =
  | { kind: 'preview'; items: DiffEntry[] }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }

export type PushArgs = RefreshArgs & { commitMessage: string }

export async function computePushPreview(args: RefreshArgs): Promise<PushPreview> {
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  const items = status.diffs.filter((d) => d.status !== 'same')
  if (items.length === 0 && status.ahead === 0) return { kind: 'nothing-to-push' }
  return { kind: 'preview', items }
}

export type PushResult =
  | { kind: 'ok' }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }
  | { kind: 'race'; retry: boolean }
  | { kind: 'auth'; message: string }
  | { kind: 'error'; message: string }

function surfaceAbsPath(args: PushArgs, d: DiffEntry): string {
  if (d.source.kind === 'claude') return join(args.claudePath!, d.surfacePath)
  const projectName = (d.source as { kind: 'cursor-project'; projectName: string }).projectName
  const proj = args.cursorProjects.find((p) => p.name === projectName)!
  return join(proj.path, d.surfacePath)
}

export async function executePush(args: PushArgs): Promise<PushResult> {
  if (!args.repoPath) return { kind: 'error', message: 'repoPath required' }
  const prevHead = await revParse(args.repoPath, 'HEAD')
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  const items = status.diffs.filter((d) => d.status !== 'same')
  if (items.length === 0 && status.ahead === 0) return { kind: 'nothing-to-push' }

  const indexFile = join(args.repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`)
  try {
    await buildAndCommitFromSource({
      repoPath: args.repoPath,
      diffs: items,
      sourceContent: (d) => {
        if (d.status === 'deleted') return null
        return readSourceForCommit(surfaceAbsPath(args, d), d.surfacePath)
      },
      commitMessage: args.commitMessage,
      indexFile,
    })
  } catch (e) {
    return { kind: 'error', message: (e as Error).message }
  }

  const push = await pushOrigin(args.repoPath, 'main', args.token)
  if (!push.ok) {
    const kind = classifyRemoteError(push.stderr)
    // Rollback ref so WT/HEAD stays in original state
    await updateRef(args.repoPath, 'refs/heads/main', prevHead)
    await syncWtToHead(args.repoPath)
    if (kind === 'non-ff') return { kind: 'race', retry: true }
    if (kind === 'auth') return { kind: 'auth', message: push.stderr }
    return { kind: 'error', message: push.stderr }
  }
  return { kind: 'ok' }
}
