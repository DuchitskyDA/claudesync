import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncStatus, ClaudeConfig } from '@shared/api'
import type { ClaudeProject, CursorProject } from '@shared/api'
import { refreshStatus } from './sync/engine/engine'
import { loadToken } from './safe-storage'

const DEFAULT_SYNC_GLOBAL: ClaudeConfig['syncGlobal'] = {
  claudeMd: true, commands: true, skills: true, settings: true,
}

export type SyncStatusOpts = {
  repoPath: string | null
  claudePath: string | null
  claudeProjects: ClaudeProject[]
  cursorProjects: CursorProject[]
  userDataDir: string
  doFetch: boolean
  syncGlobal?: ClaudeConfig['syncGlobal']
}

/** Adapter: maps EngineStatus → SyncStatus (existing IPC contract). */
export async function getSyncStatus(opts: SyncStatusOpts): Promise<SyncStatus> {
  if (!opts.repoPath || !existsSync(join(opts.repoPath, '.git'))) {
    return { state: 'no-remote', behind: 0, ahead: 0, localChanges: 0, fetchedAt: null }
  }
  const token = loadToken(opts.userDataDir)
  const s = await refreshStatus({
    repoPath: opts.repoPath,
    claudePath: opts.claudePath,
    claudeProjects: opts.claudeProjects,
    cursorProjects: opts.cursorProjects,
    token,
    doFetch: opts.doFetch,
    syncGlobal: opts.syncGlobal ?? DEFAULT_SYNC_GLOBAL,
  })
  const out: SyncStatus = {
    state: s.state,
    behind: s.behind,
    ahead: s.ahead,
    localChanges: s.localChanges,
    fetchedAt: s.fetchedAt,
  }
  if (s.errorKey) out.errorKey = s.errorKey
  if (s.foreignPaths.length > 0) out.foreignPaths = s.foreignPaths
  return out
}
