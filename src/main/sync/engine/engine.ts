import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { ClaudeProject, CursorProject } from '@shared/api'
import type { EngineStatus, DiffEntry, SourceRef, PreviewItem } from '@shared/sync-types'
import { enumClaudeSource, enumCursorProjectSource, readSourceForCommit } from './source-enum'
import { enumHead } from './head-enum'
import { compare } from './comparator'
import { fetchOrigin, revListCount, revParse, pushOrigin, updateRef, syncWtToHead, classifyRemoteError, catFileBlob } from './git-ops'
import { buildAndCommitFromSource } from './index-builder'
import { applyToSource, mergeSettingsForPull, readSourceIfExists } from './pull-apply'
import { encodeClaudeProjectSegment } from './rules'

export type RefreshArgs = {
  repoPath: string | null
  claudePath: string | null
  claudeProjects: ClaudeProject[]
  cursorProjects: CursorProject[]
  token: string | null
  doFetch?: boolean
}

/**
 * Translate a repo-side `claude/...` path into the local on-disk relative path
 * under `~/.claude`. For `projects/<name>/memory/...` we swap `<name>` for the
 * locally-registered encoded directory. Returns null when the project name is
 * present in the repo but not registered on this device (caller treats as skip,
 * same pattern we already use for unregistered Cursor projects).
 */
function claudeRepoRelToSurfaceRel(
  repoRel: string,
  claudeProjects: ClaudeProject[],
): string | null {
  const m = repoRel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
  if (!m) return repoRel
  const name = m[1]!
  const tail = m[2]!
  const proj = claudeProjects.find((p) => p.name === name)
  if (!proj) return null
  return `projects/${encodeClaudeProjectSegment(proj.path)}/${tail}`
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
    const srcEntries = await enumClaudeSource(claudePath, args.claudeProjects)
    const headEntries = await enumHead(repoPath, 'claude/', 'claude/')
    // Filter HEAD entries belonging to claude/projects/<name> where <name> is
    // not registered locally — otherwise compare() would see them as
    // "deleted-on-source" and try to wipe data the user never opted in to.
    const filteredHead = headEntries.filter((h) => {
      const rel = h.repoPath.startsWith('claude/') ? h.repoPath.slice('claude/'.length) : h.repoPath
      return claudeRepoRelToSurfaceRel(rel, args.claudeProjects) !== null
    })
    const part = compare(src, srcEntries, filteredHead.map((h) => ({ ...h, sha: h.sha1 })), args.claudeProjects)
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

/** Resolve the absolute source path for a diff entry. Returns null when the
 *  entry belongs to a Cursor project that isn't registered on this machine —
 *  callers must treat this as "skip" rather than throw. This happens cross-
 *  machine when machine A pushed a project that machine B never registered. */
function surfaceAbsPath(args: RefreshArgs, d: DiffEntry): string | null {
  if (d.source.kind === 'claude') {
    if (!args.claudePath) return null
    return join(args.claudePath, d.surfacePath)
  }
  const projectName = d.source.projectName
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
  const items = status.diffs.filter((d) => d.status !== 'same')
  if (items.length === 0 && status.ahead === 0) return { kind: 'nothing-to-push' }

  const indexFile = join(args.repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`)
  try {
    await buildAndCommitFromSource({
      repoPath: args.repoPath,
      diffs: items,
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

    let surfacePath: string
    let source: { kind: 'claude' } | { kind: 'cursor-project'; projectName: string }
    if (path.startsWith('claude/')) {
      source = { kind: 'claude' }
      const repoRel = path.slice('claude/'.length)
      const mapped = claudeRepoRelToSurfaceRel(repoRel, args.claudeProjects)
      if (mapped === null) continue // project in repo not registered locally — skip
      surfacePath = mapped
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
    // Map repo path → source absolute path. Skip cursor entries whose project
    // is not registered on this machine: there's no source dir to read/write.
    let srcAbs: string | null
    if (source.kind === 'claude') {
      srcAbs = args.claudePath ? join(args.claudePath, surfacePath) : null
    } else {
      const proj = args.cursorProjects.find((p) => p.name === source.projectName)
      srcAbs = proj ? join(proj.path, surfacePath) : null
    }
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
    const surfaceAbs = surfaceAbsPath(args, d)
    if (!surfaceAbs) continue  // unregistered cursor project — skip silently
    if (d.status === 'added') {
      // file in source, not in HEAD → discard means delete from source
      await applyToSource(surfaceAbs, null)
    } else if (d.status === 'modified' || d.status === 'deleted') {
      // pull HEAD's content to source
      const prefix = d.source.kind === 'claude' ? 'claude/' : `cursor/projects/${d.source.projectName}/`
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
