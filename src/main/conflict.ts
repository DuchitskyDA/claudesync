// src/main/conflict.ts — thin IPC wrapper over Engine.Resolver
import type { ResolverState } from '@shared/sync-types'
import { readConfig } from './config'
import { loadToken } from './safe-storage'
import {
  loadResolverState,
  computeResolverState,
  executeResolve,
  clearResolverState,
} from './sync/engine/resolver'

function getResolverArgs(configPath: string, userDataDir: string) {
  const cfg = readConfig(configPath)
  return {
    repoPath: cfg.repoPath ?? '',
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    userDataDir,
  }
}

export async function getResolverStateIPC(
  configPath: string,
  userDataDir: string,
): Promise<ResolverState | null> {
  const existing = loadResolverState(userDataDir)
  if (existing) return existing
  const args = getResolverArgs(configPath, userDataDir)
  if (!args.repoPath) return null
  try {
    return await computeResolverState(args)
  } catch {
    return null
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
