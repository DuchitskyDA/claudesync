// src/main/conflict.ts — thin IPC wrapper over Engine.Resolver
import type { ResolverState } from '@shared/sync-types'
import { readConfig } from './config'
import { loadToken } from './safe-storage'
import {
  loadResolverState,
  computeResolverState,
  executeResolve,
  clearResolverState,
  isResolverStateFresh,
} from './sync/engine/resolver'
import { revParse } from './sync/engine/git-ops'

function getResolverArgs(configPath: string, userDataDir: string) {
  const cfg = readConfig(configPath)
  return {
    repoPath: cfg.repoPath ?? '',
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    userDataDir,
  }
}

export async function getResolverStateIPC(
  configPath: string,
  userDataDir: string,
): Promise<ResolverState | null> {
  const args = getResolverArgs(configPath, userDataDir)
  const existing = loadResolverState(userDataDir)
  if (!args.repoPath) return existing

  // Reuse a persisted state only if it still matches the repo's current HEAD
  // and origin/main — that preserves in-progress choices across restarts.
  // A stale persisted state (e.g. an empty one left over from when the repo
  // was in sync) would otherwise make the modal show "nothing to resolve"
  // even though the repo has since diverged. When stale, recompute.
  if (existing) {
    try {
      const head = await revParse(args.repoPath, 'HEAD')
      const theirs = await revParse(args.repoPath, 'origin/main')
      if (isResolverStateFresh(existing, head, theirs)) return existing
    } catch {
      // Can't verify (e.g. origin/main unavailable) — fall through to recompute.
    }
  }

  try {
    return await computeResolverState(args)
  } catch {
    return existing
  }
}

export async function executeResolveIPC(
  configPath: string,
  userDataDir: string,
  commitMessage: string,
  resolutions: ResolverState,
): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  const args = getResolverArgs(configPath, userDataDir)
  if (!args.repoPath) return { kind: 'error', message: 'Repo path not configured' }
  return executeResolve({ ...args, commitMessage, resolutions })
}

export function discardResolverIPC(userDataDir: string): void {
  clearResolverState(userDataDir)
}
