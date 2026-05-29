import { describe, it, expect } from 'vitest'
import type { DiffEntry, SourceRef } from '@shared/sync-types'
import { checkFloor, refKey, DEFAULT_FLOOR_THRESHOLDS } from '../../../src/main/sync/engine/safety-floor'

const G: SourceRef = { kind: 'claude-global' }

function del(repoPath: string, source: SourceRef = G): DiffEntry {
  return { source, repoPath, surfacePath: repoPath, status: 'deleted', headSha: 'x' }
}
function mod(repoPath: string, source: SourceRef = G): DiffEntry {
  return { source, repoPath, surfacePath: repoPath, status: 'modified', sourceSha: 'a', headSha: 'b' }
}

describe('checkFloor', () => {
  it('ok when nothing deleted', () => {
    const r = checkFloor([mod('claude/a'), mod('claude/b')], new Map([['claude-global', 2]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(true)
  })

  it('ok when deletions below ratio', () => {
    const diffs = [del('claude/a'), del('claude/b')]
    const r = checkFloor(diffs, new Map([['claude-global', 10]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(true)
  })

  it('ok when ratio exceeded but below minAbs', () => {
    const diffs = [del('claude/a'), del('claude/b'), del('claude/c')]
    const r = checkFloor(diffs, new Map([['claude-global', 4]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(true)
  })

  it('blocks ratio-exceeded when >=ratio and >=minAbs', () => {
    const diffs = [del('claude/a'), del('claude/b'), del('claude/c'), del('claude/d'), del('claude/e')]
    const r = checkFloor(diffs, new Map([['claude-global', 8]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected blocked')
    expect(r.blocked).toHaveLength(1)
    expect(r.blocked[0]!.reason).toBe('ratio-exceeded')
    expect(r.blocked[0]!.deleting).toBe(5)
    expect(r.blocked[0]!.headCount).toBe(8)
  })

  it('blocks source-empty: every tracked file deleted (headCount>=1)', () => {
    const diffs = Array.from({ length: 6 }, (_, i) => del(`claude/f${i}`))
    const r = checkFloor(diffs, new Map([['claude-global', 6]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected blocked')
    expect(r.blocked[0]!.reason).toBe('source-empty')
  })

  it('source-empty triggers even below minAbs (whole small source vanished)', () => {
    const diffs = [del('claude/a'), del('claude/b')]
    const r = checkFloor(diffs, new Map([['claude-global', 2]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected blocked')
    expect(r.blocked[0]!.reason).toBe('source-empty')
  })

  it('isolates per source: one anomalous, one fine', () => {
    const P: SourceRef = { kind: 'cursor-project', projectName: 'foo' }
    const diffs = [
      del('claude/a'), del('claude/b'), del('claude/c'), del('claude/d'), del('claude/e'),
      del('cursor/projects/foo/x', P),
    ]
    const heads = new Map([['claude-global', 8], ['cursor-project::foo', 10]])
    const r = checkFloor(diffs, heads, DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected blocked')
    expect(r.blocked).toHaveLength(1)
    expect(r.blocked[0]!.source).toEqual(G)
  })

  it('unreadable entries are not counted as deletions', () => {
    const diffs: DiffEntry[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ source: G, repoPath: `claude/u${i}`, surfacePath: `u${i}`, status: 'unreadable' as const, headSha: 'h' })),
    ]
    const r = checkFloor(diffs, new Map([['claude-global', 6]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(true)
  })

  it('refKey serializes sources stably', () => {
    expect(refKey({ kind: 'claude-global' })).toBe('claude-global')
    expect(refKey({ kind: 'claude-project-memory', projectName: 'a' })).toBe('claude-project-memory::a')
    expect(refKey({ kind: 'cursor-project', projectName: 'b' })).toBe('cursor-project::b')
  })
})
