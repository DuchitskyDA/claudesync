// tests/main/engine/comparator.test.ts
import { describe, it, expect } from 'vitest'
import { compare } from '../../../src/main/sync/engine/comparator'
import type { FileEntry } from '@shared/sync-types'

const claude = { kind: 'claude-global' as const }
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

describe('compare — unreadable handling', () => {
  const G = { kind: 'claude-global' as const }
  const fe = (repoPath: string, sha1: string) => ({
    repoPath, surfacePath: repoPath.replace(/^claude\//, ''), sha1, mode: '100644' as const, size: 1,
  })
  const he = (repoPath: string, sha: string) => ({ repoPath, sha, mode: '100644' as const, size: 1 })

  it('unreadable file present in HEAD → status unreadable with headSha, never deleted', () => {
    const out = compare(
      G,
      [],
      [he('claude/CLAUDE.md', 'h1')],
      [],
      new Set(['claude/CLAUDE.md']),
    )
    const d = out.find((e) => e.repoPath === 'claude/CLAUDE.md')!
    expect(d.status).toBe('unreadable')
    expect(d.headSha).toBe('h1')
  })

  it('unreadable new file (not in HEAD) → status unreadable, no headSha', () => {
    const out = compare(G, [], [], [], new Set(['claude/new.md']))
    const d = out.find((e) => e.repoPath === 'claude/new.md')!
    expect(d.status).toBe('unreadable')
    expect(d.headSha).toBeUndefined()
  })

  it('readable file still in entries is unaffected by unreadable set', () => {
    const out = compare(G, [fe('claude/a.md', 's1')], [he('claude/a.md', 's1')], [], new Set())
    expect(out.find((e) => e.repoPath === 'claude/a.md')!.status).toBe('same')
  })

  it('omitted unreadable arg behaves like before (deleted)', () => {
    const out = compare(G, [], [he('claude/gone.md', 'h')], [])
    expect(out.find((e) => e.repoPath === 'claude/gone.md')!.status).toBe('deleted')
  })
})
