import { describe, it, expect } from 'vitest'
import { hasResolvableConflicts } from '../../src/renderer/lib/conflict'
import type { ResolverState, ResolverFile } from '@shared/sync-types'

function fileStub(repoPath: string): ResolverFile {
  return {
    repoPath,
    source: { kind: 'claude-global' },
    surfacePath: repoPath,
    base: null,
    mine: null,
    theirs: null,
    choice: null,
  } as ResolverFile
}

function stateWith(files: ResolverFile[]): ResolverState {
  return { files } as ResolverState
}

describe('hasResolvableConflicts', () => {
  it('returns false for null state (no resolver state at all)', () => {
    expect(hasResolvableConflicts(null)).toBe(false)
  })

  it('returns false for a computed state with zero files (diverged but nothing to resolve)', () => {
    expect(hasResolvableConflicts(stateWith([]))).toBe(false)
  })

  it('returns true when there is at least one file to resolve', () => {
    expect(hasResolvableConflicts(stateWith([fileStub('claude/CLAUDE.md')]))).toBe(true)
  })
})
