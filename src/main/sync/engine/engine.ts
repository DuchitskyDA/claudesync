import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { CursorProject } from '@shared/api'
import type { EngineStatus, DiffEntry, SourceRef, PreviewItem } from '@shared/sync-types'
import { enumClaudeSource, enumCursorProjectSource, readSourceForCommit } from './source-enum'
import { enumHead } from './head-enum'
import { compare } from './comparator'
import { fetchOrigin, revListCount, revParse, pushOrigin, updateRef, syncWtToHead, classifyRemoteError, catFileBlob } from './git-ops'
import { buildAndCommitFromSource } from './index-builder'
import { applyToSource, mergeSettingsForPull, readSourceIfExists } from './pull-apply'

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

export type PullPreview =
  | { kind: 'preview'; items: PreviewItem[] }
  | { kind: 'nothing-to-pull' }
  | { kind: 'diverged' }
  | { kind: 'offline' }

export async function computePullPreview(args: RefreshArgs): Promise<PullPreview> {
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  if (status.behind === 0) return { kind: 'nothing-to-pull' }

  // git diff --raw HEAD..origin/main -- claude/ cursor/projects/<each>/
  const prefixes = ['claude/']
  for (const p of args.cursorProjects) prefixes.push(`cursor/projects/${p.name}/`)
  const items: PreviewItem[] = []

  const diff = await new Promise<string>((resolve, reject) => {
    const proc = spawn('git', ['-C', args.repoPath!, 'diff', '--raw', '-z', 'HEAD..origin/main', '--', ...prefixes])
    let out = ''
    proc.stdout.on('data', (b) => out += b.toString())
    proc.on('exit', (code) => code === 0 ? resolve(out) : reject(new Error(`git diff exit ${code}`)))
    proc.on('error', reject)
  })
  // diff --raw -z output: records separated by \0, each is
  //   ":<modea> <modeb> <shaa> <shab> <status>\0<path>\0"   for non-rename
  const tokens = diff.split('\0').filter(Boolean)
  let i = 0
  while (i < tokens.length) {
    const meta = tokens[i]!
    if (!meta.startsWith(':')) { i++; continue }
    const parts = meta.split(' ')
    const status = parts[4] ?? ''
    const path = tokens[i + 1] ?? ''
    i += 2
    if (!path) continue

    let surfacePath: string
    let source: { kind: 'claude' } | { kind: 'cursor-project'; projectName: string }
    if (path.startsWith('claude/')) {
      source = { kind: 'claude' }
      surfacePath = path.slice('claude/'.length)
    } else {
      const m = path.match(/^cursor\/projects\/([^/]+)\/(.*)$/)
      if (!m) continue
      source = { kind: 'cursor-project', projectName: m[1]! }
      surfacePath = m[2]!
    }

    let st: PreviewItem['status']
    if (status === 'A') st = 'added'
    else if (status === 'D') st = 'deleted'
    else st = 'modified'

    const sa = parts[2]
    const sb = parts[3]
    let newContent: Buffer | undefined
    if (st !== 'deleted' && sb && sb !== '0000000000000000000000000000000000000000') {
      newContent = await catFileBlob(args.repoPath!, sb)
    }
    const srcAbs = source.kind === 'claude'
      ? join(args.claudePath!, surfacePath)
      : join(args.cursorProjects.find((p) => p.name === source.projectName)!.path, surfacePath)
    const currentContent = readSourceIfExists(srcAbs) ?? undefined

    items.push({
      source, repoPath: path, surfacePath, status: st,
      sourceSha: sa, headSha: sb,
      newContent, currentContent,
    })
  }

  return { kind: 'preview', items }
}

export type PullApplyArgs = RefreshArgs & { deletionsToApply: string[] }

export async function executePullApply(args: PullApplyArgs): Promise<{ kind: 'ok' } | { kind: 'error'; message: string } | { kind: 'diverged' }> {
  const preview = await computePullPreview(args)
  if (preview.kind !== 'preview') {
    if (preview.kind === 'diverged') return { kind: 'diverged' }
    return { kind: 'error', message: `unexpected preview kind ${preview.kind}` }
  }
  const deletionsSet = new Set(args.deletionsToApply)

  for (const item of preview.items) {
    const surfaceAbs = item.source.kind === 'claude'
      ? join(args.claudePath!, item.surfacePath)
      : join(args.cursorProjects.find((p) => p.name === (item.source as { kind: 'cursor-project'; projectName: string }).projectName)!.path, item.surfacePath)

    if (item.status === 'deleted') {
      if (deletionsSet.has(item.repoPath)) {
        await applyToSource(surfaceAbs, null)
      }
      continue
    }
    if (item.newContent === undefined) continue

    let toWrite = item.newContent
    if (item.source.kind === 'claude' && item.surfacePath === 'settings.json') {
      const currentSrc = readSourceIfExists(surfaceAbs)
      toWrite = mergeSettingsForPull(item.newContent, currentSrc)
    }
    await applyToSource(surfaceAbs, toWrite)
  }

  // fast-forward HEAD to origin/main
  await updateRef(args.repoPath!, 'refs/heads/main', await revParse(args.repoPath!, 'origin/main'))
  await syncWtToHead(args.repoPath!)
  return { kind: 'ok' }
}

export async function executeDiscard(args: RefreshArgs): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!args.repoPath) return { kind: 'error', message: 'repoPath required' }
  const status = await refreshStatus({ ...args, doFetch: false })
  for (const d of status.diffs) {
    if (d.status === 'same') continue
    const surfaceAbs = d.source.kind === 'claude'
      ? join(args.claudePath!, d.surfacePath)
      : join(args.cursorProjects.find((p) => p.name === (d.source as { kind: 'cursor-project'; projectName: string }).projectName)!.path, d.surfacePath)
    if (d.status === 'added') {
      // file in source, not in HEAD → discard means delete from source
      await applyToSource(surfaceAbs, null)
    } else if (d.status === 'modified' || d.status === 'deleted') {
      // pull HEAD's content to source
      const prefix = d.source.kind === 'claude' ? 'claude/' : `cursor/projects/${(d.source as { kind: 'cursor-project'; projectName: string }).projectName}/`
      const head = await enumHead(args.repoPath, prefix, prefix)
      const entry = head.find((h) => h.repoPath === d.repoPath)
      if (entry) {
        const blob = await catFileBlob(args.repoPath, entry.sha1)
        await applyToSource(surfaceAbs, blob)
      }
    }
  }
  return { kind: 'ok' }
}
