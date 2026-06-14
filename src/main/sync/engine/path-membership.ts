// src/main/sync/engine/path-membership.ts
// Single source of truth for "does this repo path belong to the sync set".
// Used by BOTH the HEAD filter in refreshStatus and computePullPreview, so
// push and pull can never disagree (К4). Sub-project №2 (manifest) will
// replace the internals of classifyRepoPath without touching its callers.
import type { ClaudeProject, CursorProject, ClaudeGlobalSyncFlags } from '@shared/api'
import type { SourceRef } from '@shared/sync-types'
import { encodeClaudeProjectSegment, projectDotClaudeIsGlobal } from './rules'

export type MembershipCtx = {
  claudeProjects: ClaudeProject[]
  cursorProjects: CursorProject[]
  syncGlobal: ClaudeGlobalSyncFlags
  /** Global ~/.claude path. Used to skip a project whose own .claude IS the
   *  global dir (would otherwise duplicate the global config). Optional —
   *  absent means the guard is inactive (callers that don't sync projects). */
  claudePath?: string | null
}

export type Classified =
  | { ok: { source: SourceRef; surfacePath: string } }
  | { skip: 'unknown-path' | 'toggle-off' | 'unregistered-project' }

export function classifyRepoPath(repoPath: string, ctx: MembershipCtx): Classified {
  if (repoPath.startsWith('claude/')) {
    const rel = repoPath.slice('claude/'.length)
    if (!rel.startsWith('projects/')) {
      const global = (on: boolean): Classified =>
        on ? { ok: { source: { kind: 'claude-global' }, surfacePath: rel } } : { skip: 'toggle-off' }
      if (rel === 'CLAUDE.md') return global(ctx.syncGlobal.claudeMd)
      if (rel === 'settings.json') return global(ctx.syncGlobal.settings)
      if (rel.startsWith('commands/')) return global(ctx.syncGlobal.commands)
      if (rel.startsWith('skills/')) return global(ctx.syncGlobal.skills)
      return { skip: 'unknown-path' }
    }
    const mDot = rel.match(/^projects\/([^/]+)\/\.claude\/(.*)$/)
    if (mDot) {
      const proj = ctx.claudeProjects.find((p) => p.name === mDot[1])
      if (!proj) return { skip: 'unregistered-project' }
      if (!proj.syncDotClaude) return { skip: 'toggle-off' }
      // A project whose .claude IS the global dir would duplicate the global
      // config — never a member.
      if (projectDotClaudeIsGlobal(proj.path, ctx.claudePath)) return { skip: 'toggle-off' }
      return {
        ok: {
          source: { kind: 'claude-project-dotclaude', projectName: mDot[1]! },
          surfacePath: `.claude/${mDot[2]!}`,
        },
      }
    }
    const mMem = rel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
    if (mMem) {
      const proj = ctx.claudeProjects.find((p) => p.name === mMem[1])
      if (!proj) return { skip: 'unregistered-project' }
      if (!proj.syncMemory) return { skip: 'toggle-off' }
      return {
        ok: {
          source: { kind: 'claude-project-memory', projectName: mMem[1]! },
          surfacePath: `projects/${encodeClaudeProjectSegment(proj.path)}/${mMem[2]!}`,
        },
      }
    }
    return { skip: 'unknown-path' }
  }
  const mCur = repoPath.match(/^cursor\/projects\/([^/]+)\/(.*)$/)
  if (mCur && mCur[2]) {
    const proj = ctx.cursorProjects.find((p) => p.name === mCur[1])
    if (!proj) return { skip: 'unregistered-project' }
    return {
      ok: { source: { kind: 'cursor-project', projectName: mCur[1]! }, surfacePath: mCur[2]! },
    }
  }
  return { skip: 'unknown-path' }
}
