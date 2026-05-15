// tests/main/engine/comparator.test.ts
import { describe, it, expect } from 'vitest'
import { compare } from '../../../src/main/sync/engine/comparator'
import type { FileEntry } from '@shared/sync-types'

const claude = { kind: 'claude' as const }
const e = (repoPath: string, sha: string): FileEntry => ({
  repoPath, surfacePath: repoPath.replace(/^claude\//, ''), sha1: sha, mode: '100644', size: 1
})

describe('compare', () => {
  it('same when shas equal', () => {
    const out = compare(claude, [e('claude/CLAUDE.md', 'aaa')], [{ repoPath: 'claude/CLAUDE.md', sha: 'aaa', mode: '100644', size: 1 }])
    expect(out).toEqual([{ source: claude, repoPath: 'claude/CLAUDE.md', surfacePath: 'CLAUDE.md', status: 'same', sourceSha: 'aaa', headSha: 'aaa' }])
  })
  it('modified when shas differ', () => {
    const out = compare(claude, [e('claude/CLAUDE.md', 'aaa')], [{ repoPath: 'claude/CLAUDE.md', sha: 'bbb', mode: '100644', size: 1 }])
    expect(out[0]?.status).toBe('modified')
  })
  it('added when not in HEAD', () => {
    const out = compare(claude, [e('claude/new.md', 'aaa')], [])
    expect(out[0]?.status).toBe('added')
    expect(out[0]?.headSha).toBeUndefined()
  })
  it('deleted when not in source', () => {
    const out = compare(claude, [], [{ repoPath: 'claude/gone.md', sha: 'aaa', mode: '100644', size: 1 }])
    expect(out[0]?.status).toBe('deleted')
    expect(out[0]?.sourceSha).toBeUndefined()
  })
})
