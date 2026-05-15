import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncStatus } from '@shared/api'
import type { CursorProject } from '@shared/api'
import { refreshStatus } from './sync/engine/engine'
import { loadToken } from './safe-storage'

export type SyncStatusOpts = {
  repoPath: string | null
  claudePath: string | null
  cursorProjects: CursorProject[]
  userDataDir: string
  doFetch: boolean
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
    cursorProjects: opts.cursorProjects,
    token,
    doFetch: opts.doFetch,
  })
  const out: SyncStatus = {
    state: s.state,
    behind: s.behind,
    ahead: s.ahead,
    localChanges: s.localChanges,
    fetchedAt: s.fetchedAt,
  }
  if (s.errorKey) out.errorKey = s.errorKey
  return out
}
