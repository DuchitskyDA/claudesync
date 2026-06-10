import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { ClaudeProject, CursorProject, ClaudeConfig } from '@shared/api'
import type { EngineStatus, DiffEntry, SourceRef, PreviewItem } from '@shared/sync-types'
import { enumClaudeSource, enumCursorProjectSource, readSourceForCommit, enumClaudeProjectDotClaudeSource } from './source-enum'
import { enumHead } from './head-enum'
import { compare } from './comparator'
import { fetchOrigin, revListCount, revParse, pushOrigin, updateRef, syncWtToHead, classifyRemoteError, catFileBlob } from './git-ops'
import { buildAndCommitFromSource } from './index-builder'
import { applyToSource, mergeSettingsForPull, readSourceIfExists } from './pull-apply'
import { checkFloor, refKey, DEFAULT_FLOOR_THRESHOLDS, type FloorThresholds, type FloorSourceVerdict } from './safety-floor'
import { classifyRepoPath, type MembershipCtx } from './path-membership'

export type RefreshArgs = {
  repoPath: string | null
  claudePath: string | null
  claudeProjects: ClaudeProject[]
  cursorProjects: CursorProject[]
  token: string | null
  doFetch?: boolean
  /** Global category toggles for ~/.claude top-level entries. */
  syncGlobal: ClaudeConfig['syncGlobal']
  /** Optional override of mass-deletion floor thresholds. */
  floorThresholds?: FloorThresholds
}

const EMPTY_STATUS: EngineStatus = {
  state: 'no-remote', ahead: 0, behind: 0, localChanges: 0, diffs: [], fetchedAt: null, foreignPaths: [],
}

export async function refreshStatus(args: RefreshArgs): Promise<EngineStatus> {
  const { repoPath, claudePath, cursorProjects, token } = args
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return EMPTY_STATUS

  const membershipCtx: MembershipCtx = {
    claudeProjects: args.claudeProjects,
    cursorProjects: args.cursorProjects,
    syncGlobal: args.syncGlobal,
  }
  const foreignPaths: string[] = []

  const diffs: DiffEntry[] = []

  // Claude
  if (claudePath) {
    type Entry = { ref: SourceRef; file: import('@shared/sync-types').FileEntry }
    const allSrc: Entry[] = []
    const unreadableSet = new Set<string>()
    const globalRes = await enumClaudeSource(claudePath, args.claudeProjects, args.syncGlobal)
    for (const u of globalRes.unreadable) unreadableSet.add(u)
    for (const f of globalRes.entries) {
      const m = f.repoPath.match(/^claude\/projects\/([^/]+)\/memory\//)
      if (m) {
        allSrc.push({ ref: { kind: 'claude-project-memory', projectName: m[1]! }, file: f })
      } else {
        allSrc.push({ ref: { kind: 'claude-global' }, file: f })
      }
    }
    for (const proj of args.claudeProjects) {
      if (!proj.syncDotClaude) continue
      const dotRes = await enumClaudeProjectDotClaudeSource(proj.path, proj.name)
      for (const u of dotRes.unreadable) unreadableSet.add(u)
      for (const f of dotRes.entries) {
        allSrc.push({ ref: { kind: 'claude-project-dotclaude', projectName: proj.name }, file: f })
      }
    }

    // HEAD entries with filtering by toggles via classifyRepoPath.
    const headEntries = await enumHead(repoPath, 'claude/', 'claude/')
    const filteredHead: typeof headEntries = []
    for (const h of headEntries) {
      const c = classifyRepoPath(h.repoPath, membershipCtx)
      if ('ok' in c) filteredHead.push(h)
      else if (c.skip === 'unknown-path') foreignPaths.push(h.repoPath)
      // toggle-off / unregistered-project: excluded symmetrically (≠ deletion)
    }

    // Group source entries by SourceRef, group HEAD entries similarly, run compare per group.
    const byRefKey = new Map<string, { ref: SourceRef; files: Entry['file'][] }>()
    for (const e of allSrc) {
      const key = e.ref.kind === 'claude-global'
        ? 'claude-global'
        : `${e.ref.kind}::${(e.ref as { projectName: string }).projectName}`
      let bucket = byRefKey.get(key)
      if (!bucket) {
        bucket = { ref: e.ref, files: [] }
        byRefKey.set(key, bucket)
      }
      bucket.files.push(e.file)
    }
    function refForRepoPath(p: string): SourceRef | null {
      const c = classifyRepoPath(p, membershipCtx)
      return 'ok' in c ? c.ok.source : null
    }
    function refKeyForRepoPath(p: string): string {
      const ref = refForRepoPath(p)
      if (!ref) return ''
      return ref.kind === 'claude-global' ? 'claude-global' : `${ref.kind}::${ref.projectName}`
    }
    const headByKey = new Map<string, typeof filteredHead>()
    for (const h of filteredHead) {
      const ref = refForRepoPath(h.repoPath)
      if (!ref) continue
      const key = ref.kind === 'claude-global'
        ? 'claude-global'
        : `${ref.kind}::${(ref as { projectName: string }).projectName}`
      if (!byRefKey.has(key)) byRefKey.set(key, { ref, files: [] })
      if (!headByKey.has(key)) headByKey.set(key, [])
      headByKey.get(key)!.push(h)
    }
    for (const [key, bucket] of byRefKey) {
      const heads = headByKey.get(key) ?? []
      // unreadable repoPaths that belong to this ref-group
      const groupUnreadable = new Set<string>()
      for (const u of unreadableSet) {
        if (refKeyForRepoPath(u) === key) groupUnreadable.add(u)
      }
      const part = compare(bucket.ref, bucket.files,
        heads.map((h) => ({ ...h, sha: h.sha1 })), args.claudeProjects, groupUnreadable)
      diffs.push(...part)
    }
  }

  // Cursor projects
  for (const proj of cursorProjects) {
    const src: SourceRef = { kind: 'cursor-project', projectName: proj.name }
    const res = await enumCursorProjectSource(proj.path, proj.name)
    const headEntries = await enumHead(repoPath, `cursor/projects/${proj.name}/`, `cursor/projects/${proj.name}/`)
    const part = compare(src, res.entries, headEntries.map((h) => ({ ...h, sha: h.sha1 })),
      [], new Set(res.unreadable))
    diffs.push(...part)
  }

  const localChanges = diffs.filter((d) => d.status !== 'same' && d.status !== 'unreadable').length

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

  return { state, ahead, behind, localChanges, diffs, fetchedAt, foreignPaths }
}

export type PushPreview =
  | { kind: 'preview'; items: DiffEntry[]; unreadable: DiffEntry[]; deletions: DiffEntry[] }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }
  | { kind: 'floor-blocked'; verdicts: FloorSourceVerdict[] }

export type PushResult =
  | { kind: 'ok' }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }
  | { kind: 'race'; retry: boolean }
  | { kind: 'auth'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'floor-blocked'; verdicts: FloorSourceVerdict[] }

export type PushArgs = RefreshArgs & { commitMessage: string; approvedDeletions: string[] }

/** HEAD file count per source, derived from the already-toggle-filtered diffs.
 *  A diff with a `headSha` is present in HEAD. Deriving from diffs (rather than
 *  re-enumerating HEAD) guarantees the floor's denominator matches exactly the
 *  set that can actually produce deletions — disabled categories are excluded. */
function headCountsBySource(diffs: DiffEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const d of diffs) {
    if (!d.headSha) continue // not present in HEAD (e.g. 'added' or unreadable-new)
    const key = refKey(d.source)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export async function computePushPreview(args: RefreshArgs): Promise<PushPreview> {
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  const thresholds = args.floorThresholds ?? DEFAULT_FLOOR_THRESHOLDS
  const heads = headCountsBySource(status.diffs)
  const floor = checkFloor(status.diffs, heads, thresholds)
  if (!floor.ok) return { kind: 'floor-blocked', verdicts: floor.blocked }
  const changed = status.diffs.filter((d) => d.status === 'added' || d.status === 'modified')
  const deletions = status.diffs.filter((d) => d.status === 'deleted')
  const unreadable = status.diffs.filter((d) => d.status === 'unreadable')
  if (changed.length === 0 && deletions.length === 0 && status.ahead === 0) {
    return { kind: 'nothing-to-push' }
  }
  return { kind: 'preview', items: [...changed, ...deletions], unreadable, deletions }
}

/** Resolve the absolute source path for a diff entry. Returns null when the
 *  entry belongs to a Cursor project that isn't registered on this machine —
 *  callers must treat this as "skip" rather than throw. This happens cross-
 *  machine when machine A pushed a project that machine B never registered. */
function surfaceAbsPath(args: RefreshArgs, d: Pick<DiffEntry, 'source' | 'surfacePath'>): string | null {
  if (d.source.kind === 'claude-global') {
    if (!args.claudePath) return null
    return join(args.claudePath, d.surfacePath)
  }
  if (d.source.kind === 'claude-project-memory') {
    if (!args.claudePath) return null
    return join(args.claudePath, d.surfacePath)
  }
  if (d.source.kind === 'claude-project-dotclaude') {
    const src = d.source
    const proj = args.claudeProjects.find((p) => p.name === src.projectName)
    if (!proj) return null
    return join(proj.path, d.surfacePath)
  }
  // cursor-project
  const src = d.source
  const projectName = src.projectName
  const proj = args.cursorProjects.find((p) => p.name === projectName)
  if (!proj) return null
  return join(proj.path, d.surfacePath)
}

export async function executePush(args: PushArgs): Promise<PushResult> {
  if (!args.repoPath) return { kind: 'error', message: 'repoPath required' }
  const prevHead = await revParse(args.repoPath, 'HEAD')
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  const thresholds = args.floorThresholds ?? DEFAULT_FLOOR_THRESHOLDS
  const heads = headCountsBySource(status.diffs)
  const floor = checkFloor(status.diffs, heads, thresholds)
  if (!floor.ok) return { kind: 'floor-blocked', verdicts: floor.blocked }

  const approved = new Set(args.approvedDeletions)
  // Build set: changes + only-approved deletions. Unreadable are never built
  // (their HEAD blob stays in the tree because readTreeIntoIndex seeds from HEAD).
  // Unapproved deletions are simply omitted → they keep their HEAD blob, and the
  // push reports nothing-to-push if they were the only pending change.
  const toBuild = status.diffs.filter((d) =>
    d.status === 'added' || d.status === 'modified' ||
    (d.status === 'deleted' && approved.has(d.repoPath)))
  if (toBuild.length === 0 && status.ahead === 0) return { kind: 'nothing-to-push' }

  const indexFile = join(args.repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`)
  try {
    await buildAndCommitFromSource({
      repoPath: args.repoPath,
      diffs: toBuild,
      sourceContent: (d) => {
        if (d.status === 'deleted') return null
        const abs = surfaceAbsPath(args, d)
        if (!abs) return null
        return readSourceForCommit(abs, d.surfacePath)
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
    const proc = spawn(
      'git',
      ['-C', args.repoPath!, 'diff', '--raw', '-z', 'HEAD..origin/main', '--', ...prefixes],
      {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          GCM_INTERACTIVE: 'Never',
        } as NodeJS.ProcessEnv,
      },
    )
    let out = ''
    let err = ''
    proc.stdout.on('data', (b) => out += b.toString())
    proc.stderr.on('data', (b) => err += b.toString())
    proc.on('exit', (code) => code === 0 ? resolve(out) : reject(new Error(`git diff exit ${code}: ${err.trim()}`)))
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

    const c = classifyRepoPath(path, {
      claudeProjects: args.claudeProjects,
      cursorProjects: args.cursorProjects,
      syncGlobal: args.syncGlobal,
    })
    if (!('ok' in c)) continue // unknown-path / toggle-off / unregistered — symmetric with push
    const source = c.ok.source
    const surfacePath = c.ok.surfacePath

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
    const srcAbs = surfaceAbsPath(args, { source, surfacePath })
    if (!srcAbs) continue
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
    const surfaceAbs = surfaceAbsPath(args, item)
    if (!surfaceAbs) continue  // unregistered cursor project — skip silently

    if (item.status === 'deleted') {
      if (deletionsSet.has(item.repoPath)) {
        await applyToSource(surfaceAbs, null)
      }
      continue
    }
    if (item.newContent === undefined) continue

    let toWrite = item.newContent
    const isGlobalSettings =
      item.source.kind === 'claude-global' && item.surfacePath === 'settings.json'
    const isProjectSettings =
      item.source.kind === 'claude-project-dotclaude' && item.surfacePath === '.claude/settings.json'
    if (isGlobalSettings || isProjectSettings) {
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

export async function executeDiscard(
  args: RefreshArgs & { deleteAdded?: boolean },
): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!args.repoPath) return { kind: 'error', message: 'repoPath required' }
  const status = await refreshStatus({ ...args, doFetch: false })
  for (const d of status.diffs) {
    if (d.status === 'same' || d.status === 'unreadable') continue
    const surfaceAbs = surfaceAbsPath(args, d)
    if (!surfaceAbs) continue
    if (d.status === 'added') {
      if (args.deleteAdded === true) await applyToSource(surfaceAbs, null)
      continue
    }
    if (d.status === 'modified' || d.status === 'deleted') {
      let prefix: string
      if (d.source.kind === 'claude-global') prefix = 'claude/'
      else if (d.source.kind === 'claude-project-memory') prefix = `claude/projects/${d.source.projectName}/memory/`
      else if (d.source.kind === 'claude-project-dotclaude') prefix = `claude/projects/${d.source.projectName}/.claude/`
      else prefix = `cursor/projects/${d.source.projectName}/`
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
