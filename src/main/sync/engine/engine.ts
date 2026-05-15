import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CursorProject } from '@shared/api'
import type { EngineStatus, DiffEntry, SourceRef } from '@shared/sync-types'
import { enumClaudeSource, enumCursorProjectSource } from './source-enum'
import { enumHead } from './head-enum'
import { compare } from './comparator'
import { fetchOrigin, revListCount, revParse } from './git-ops'

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
  else if (localChanges > 0 && ahead === 0) state = 'local-changes'
  else if (ahead > 0) state = 'ahead'
  else state = 'in-sync'

  return { state, ahead, behind, localChanges, diffs, fetchedAt }
}
