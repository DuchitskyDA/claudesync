# Sync Safeguards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the sync engine from inferring deletion from absence/read-errors — add an `'unreadable'` status, a per-source mass-deletion floor, explicit deletion opt-in in push preview, atomic writes, and a non-destructive Discard.

**Architecture:** Approach A from the design. Each `enum*` returns `{ entries, unreadable }`; `compare` stays pure but takes an `unreadable` set and emits a new `'unreadable'` status; a new pure `safety-floor.ts` blocks anomalous mass deletions; `engine` gates `'deleted'` behind `approvedDeletions` and Discard gates `'added'` behind `deleteAdded`; `applyToSource` writes via temp+rename. IPC/UI expose structured preview sections.

**Tech Stack:** TypeScript, Electron-Vite, React, Vitest, Node fs/crypto, git plumbing.

**Spec:** [`docs/superpowers/specs/2026-05-29-sync-safeguards-design.md`](../specs/2026-05-29-sync-safeguards-design.md)

**User-imposed constraints (every task):**
- **No git operations.** No `git add`/`commit`/`push` steps. The user owns commits. Each task ends with a verification step.
- **No `Co-Authored-By: Claude`** anywhere.
- After every task: `npx tsc --noEmit -p tsconfig.json` and `npx vitest run <relevant file>`. Do not skip.

---

## File Structure

**Create:**
- `src/main/sync/engine/safety-floor.ts` — pure floor check.
- `tests/main/engine/safety-floor.test.ts` — floor unit tests.

**Modify:**
- `src/shared/sync-types.ts` — `DiffStatus` adds `'unreadable'`.
- `src/main/sync/engine/comparator.ts` — `compare` takes `unreadable` set, emits `'unreadable'`.
- `src/main/sync/engine/source-enum.ts` — each `enum*` returns `{ entries, unreadable }`; `walk` reports unreadable dirs.
- `src/main/sync/engine/pull-apply.ts` — `applyToSource` temp+rename.
- `src/main/sync/engine/engine.ts` — wire unreadable; floor; `approvedDeletions`; `deleteAdded`.
- `src/shared/api.ts` — `RepoStatus` structured; `PushOptions` adds `approvedDeletions`.
- `src/main/ipc.ts` — `preview-push-status` structured; `run-push`/`discard` args.
- `src/preload/index.ts` — `runPush`/`discardLocalChanges` signatures.
- `src/renderer/components/PushModal.tsx` — sections + deletion checkboxes + floor block.
- `src/renderer/App.tsx` — thread `approvedDeletions` / `deleteAdded`.
- `src/renderer/i18n/locales/en.json`, `ru.json` — new keys.
- Tests updated for new signatures: `comparator.test.ts`, `source-enum.test.ts`, `engine-push.test.ts`, `engine-discard.test.ts`, `tests/fixtures/sync-roundtrip.ts`.

---

## Task 1: `DiffStatus` adds `'unreadable'`

**Files:**
- Modify: `src/shared/sync-types.ts:32`

- [ ] **Step 1: Edit the union**

Replace line 32:

```ts
export type DiffStatus = 'added' | 'modified' | 'deleted' | 'same' | 'unreadable'
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors (no consumer narrows on the union exhaustively yet).

---

## Task 2: `safety-floor.ts` — pure mass-deletion floor

**Files:**
- Create: `src/main/sync/engine/safety-floor.ts`
- Create: `tests/main/engine/safety-floor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/engine/safety-floor.test.ts`:

```ts
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
    // 2 of 10 deleted = 20% < 50%
    const diffs = [del('claude/a'), del('claude/b')]
    const r = checkFloor(diffs, new Map([['claude-global', 10]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(true)
  })

  it('ok when ratio exceeded but below minAbs', () => {
    // 3 of 4 deleted = 75% >= 50% but 3 < minAbs(5)
    const diffs = [del('claude/a'), del('claude/b'), del('claude/c')]
    const r = checkFloor(diffs, new Map([['claude-global', 4]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(true)
  })

  it('blocks ratio-exceeded when >=ratio and >=minAbs', () => {
    // 5 of 8 deleted = 62.5% >= 50% and 5 >= 5
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
    // 6 of 6 deleted = 100% — source vanished
    const diffs = Array.from({ length: 6 }, (_, i) => del(`claude/f${i}`))
    const r = checkFloor(diffs, new Map([['claude-global', 6]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected blocked')
    expect(r.blocked[0]!.reason).toBe('source-empty')
  })

  it('source-empty triggers even below minAbs (whole small source vanished)', () => {
    // 2 of 2 deleted = 100% — even though 2 < minAbs, a fully-vanished source is anomalous
    const diffs = [del('claude/a'), del('claude/b')]
    const r = checkFloor(diffs, new Map([['claude-global', 2]]), DEFAULT_FLOOR_THRESHOLDS)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected blocked')
    expect(r.blocked[0]!.reason).toBe('source-empty')
  })

  it('isolates per source: one anomalous, one fine', () => {
    const P: SourceRef = { kind: 'cursor-project', projectName: 'foo' }
    const diffs = [
      // global: 5 of 8 deleted -> blocked
      del('claude/a'), del('claude/b'), del('claude/c'), del('claude/d'), del('claude/e'),
      // cursor foo: 1 of 10 deleted -> fine
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
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/engine/safety-floor.test.ts`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Implement `safety-floor.ts`**

Create `src/main/sync/engine/safety-floor.ts`:

```ts
// src/main/sync/engine/safety-floor.ts
import type { DiffEntry, SourceRef } from '@shared/sync-types'

export type FloorThresholds = { ratio: number; minAbs: number }

/** Default: a source is anomalous when it loses >=50% of its tracked files AND
 *  that's at least 5 files, OR when the whole source vanished (every tracked
 *  file deleted). Tuned to not trip on small intentional edits. */
export const DEFAULT_FLOOR_THRESHOLDS: FloorThresholds = { ratio: 0.5, minAbs: 5 }

export type FloorSourceVerdict = {
  source: SourceRef
  headCount: number
  deleting: number
  reason: 'source-empty' | 'ratio-exceeded'
}

export type FloorResult =
  | { ok: true }
  | { ok: false; blocked: FloorSourceVerdict[] }

/** Stable string key for a SourceRef. Mirrors the keying used in engine.ts. */
export function refKey(source: SourceRef): string {
  if (source.kind === 'claude-global') return 'claude-global'
  return `${source.kind}::${source.projectName}`
}

/**
 * Per-source mass-deletion guard. `headCountBySource` maps refKey(source) → number
 * of tracked files currently in HEAD for that source. Pure: no I/O.
 */
export function checkFloor(
  diffs: DiffEntry[],
  headCountBySource: Map<string, number>,
  thresholds: FloorThresholds,
): FloorResult {
  // Count deletions per source.
  const deletingBy = new Map<string, { source: SourceRef; count: number }>()
  for (const d of diffs) {
    if (d.status !== 'deleted') continue
    const key = refKey(d.source)
    const cur = deletingBy.get(key)
    if (cur) cur.count++
    else deletingBy.set(key, { source: d.source, count: 1 })
  }

  const blocked: FloorSourceVerdict[] = []
  for (const [key, { source, count }] of deletingBy) {
    const headCount = headCountBySource.get(key) ?? 0
    if (headCount < 1) continue // nothing tracked in HEAD — can't be a mass wipe
    if (count >= headCount) {
      // Whole source vanished.
      blocked.push({ source, headCount, deleting: count, reason: 'source-empty' })
      continue
    }
    if (count >= thresholds.minAbs && count / headCount >= thresholds.ratio) {
      blocked.push({ source, headCount, deleting: count, reason: 'ratio-exceeded' })
    }
  }

  return blocked.length === 0 ? { ok: true } : { ok: false, blocked }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/engine/safety-floor.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine/safety-floor.test.ts`
Expected: typecheck clean; tests pass.

---

## Task 3: `comparator` — `unreadable` param + status

**Files:**
- Modify: `src/main/sync/engine/comparator.ts:42-71`
- Modify: `tests/main/engine/comparator.test.ts` (append tests)

- [ ] **Step 1: Write failing tests**

Append to `tests/main/engine/comparator.test.ts`:

```ts
describe('compare — unreadable handling', () => {
  const G = { kind: 'claude-global' as const }
  const fe = (repoPath: string, sha1: string) => ({
    repoPath, surfacePath: repoPath.replace(/^claude\//, ''), sha1, mode: '100644' as const, size: 1,
  })
  const he = (repoPath: string, sha: string) => ({ repoPath, sha, mode: '100644' as const, size: 1 })

  it('unreadable file present in HEAD → status unreadable with headSha, never deleted', () => {
    const out = compare(
      G,
      [], // not in entries (couldn't read it)
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
```

(Ensure `compare` is imported at the top of the file; it already is for existing tests.)

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/engine/comparator.test.ts`
Expected: FAIL — `compare` 5th arg type error / `'unreadable'` not produced.

- [ ] **Step 3: Implement**

Replace `compare` (lines 42–71) in `src/main/sync/engine/comparator.ts`:

```ts
export function compare(
  source: SourceRef,
  src: FileEntry[],
  head: HeadLike[],
  claudeProjects: ClaudeProject[] = [],
  unreadable: Set<string> = new Set(),
): DiffEntry[] {
  const srcMap = new Map(src.map((e) => [e.repoPath, e]))
  const headMap = new Map(head.map((e) => [e.repoPath, e]))
  const allPaths = new Set([...srcMap.keys(), ...headMap.keys(), ...unreadable])
  const out: DiffEntry[] = []
  for (const repoPath of allPaths) {
    const s = srcMap.get(repoPath)
    const h = headMap.get(repoPath)
    const surfacePath = s?.surfacePath ?? deriveSurfacePath(source, repoPath, claudeProjects)
    // Unreadable wins over any deleted-inference: the file exists on disk, we
    // just couldn't read it. Keep the HEAD version (if any), never delete.
    if (unreadable.has(repoPath)) {
      out.push(h
        ? { source, repoPath, surfacePath, status: 'unreadable', headSha: h.sha }
        : { source, repoPath, surfacePath, status: 'unreadable' })
      continue
    }
    if (s && h) {
      out.push({
        source, repoPath, surfacePath,
        status: s.sha1 === h.sha ? 'same' : 'modified',
        sourceSha: s.sha1, headSha: h.sha,
      })
    } else if (s) {
      out.push({ source, repoPath, surfacePath, status: 'added', sourceSha: s.sha1 })
    } else if (h) {
      out.push({ source, repoPath, surfacePath, status: 'deleted', headSha: h.sha })
    }
  }
  out.sort((a, b) => a.repoPath.localeCompare(b.repoPath))
  return out
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/engine/comparator.test.ts`
Expected: PASS (old + new).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine/comparator.test.ts`
Expected: tests pass. Typecheck may now error in `engine.ts` (still calls `compare` without unreadable — that's fine, it compiles since the param is optional; no error expected).

---

## Task 4: `source-enum` — `{ entries, unreadable }`

**Files:**
- Modify: `src/main/sync/engine/source-enum.ts`
- Modify: `tests/main/engine/source-enum.test.ts` (update calls + new tests)
- Modify: `src/main/sync/engine/engine.ts` (update enum call sites)
- Modify: `tests/fixtures/sync-roundtrip.ts` (update enum call sites)

- [ ] **Step 1: Write failing tests for unreadable surfacing**

Append to `tests/main/engine/source-enum.test.ts`:

```ts
describe('enumClaudeSource — unreadable surfacing', () => {
  it('broken settings.json → unreadable, not omitted, not deleted', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'settings.json'), '{ not valid json ')
    const out = await enumClaudeSource(claude, [], { claudeMd: true, commands: true, skills: true, settings: true })
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/CLAUDE.md'])
    expect(out.unreadable).toContain('claude/settings.json')
  })

  it('oversized file → unreadable', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'commands'), { recursive: true })
    writeFileSync(join(claude, 'commands', 'big.md'), Buffer.alloc(6 * 1024 * 1024, 0x61))
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    const out = await enumClaudeSource(claude, [], { claudeMd: true, commands: true, skills: true, settings: true })
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/CLAUDE.md'])
    expect(out.unreadable).toContain('claude/commands/big.md')
  })

  it('returns empty result (not throw) when claudePath missing', async () => {
    const out = await enumClaudeSource(join(dir, 'nope'), [], { claudeMd: true, commands: true, skills: true, settings: true })
    expect(out.entries).toEqual([])
    expect(out.unreadable).toEqual([])
  })
})

describe('enumClaudeProjectDotClaudeSource — result shape', () => {
  it('returns { entries, unreadable }', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.claude'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'CLAUDE.md'), 'hi\n')
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/projects/MyProj/.claude/CLAUDE.md'])
    expect(out.unreadable).toEqual([])
  })
})
```

Update ALL existing calls in this file: each `const out = await enumClaudeSource(...)` / `enumClaudeProjectDotClaudeSource(...)` / `enumCursorProjectSource(...)` now returns `{ entries, unreadable }`. Change existing assertions from `out.map(...)` to `out.entries.map(...)`. Apply consistently to every existing test in the file.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/engine/source-enum.test.ts`
Expected: FAIL — `.entries` undefined / type errors.

- [ ] **Step 3: Implement `source-enum.ts`**

Replace the three enumerators and `walk` in `src/main/sync/engine/source-enum.ts`. New `walk` reports whether the dir was readable; enumerators accumulate `unreadable`:

```ts
/** Returns false if this directory (or a descendant root) could not be read. */
function walk(rootAbs: string, prefixParts: string[], cb: (relPosix: string, abs: string) => void): boolean {
  if (!existsSync(rootAbs)) return true // absent ≠ unreadable; caller decides
  let entries: string[]
  try { entries = readdirSync(rootAbs) } catch { return false }
  let ok = true
  for (const name of entries) {
    const abs = join(rootAbs, name)
    let lst
    try { lst = lstatSync(abs) } catch { continue }
    if (lst.isSymbolicLink() && !existsSync(abs)) continue
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) {
      if (!walk(abs, [...prefixParts, name], cb)) ok = false
    } else if (st.isFile()) {
      const rel = posix.join(...prefixParts, name)
      cb(rel, abs)
    }
  }
  return ok
}
```

Replace `enumClaudeSource`:

```ts
export type EnumResult = {
  entries: FileEntry[]
  /** repoPath's of files that exist on disk but couldn't be read/canonicalized
   *  or exceed MAX_BYTES. Never silently dropped → never inferred as deletion. */
  unreadable: string[]
}

export async function enumClaudeSource(
  claudePath: string,
  claudeProjects: ClaudeProject[] = [],
  syncGlobal: ClaudeGlobalSyncFlags = { claudeMd: true, commands: true, skills: true, settings: true },
): Promise<EnumResult> {
  if (!existsSync(claudePath)) return { entries: [], unreadable: [] }
  const idx = projectIndex(claudeProjects)
  const out: FileEntry[] = []
  const unreadable: string[] = []

  // Resolve a disk-relative path to its repoPath, honoring memory translation.
  // Returns null when the path is outside the tracked set (e.g. unregistered
  // project or memory toggle off) — such paths are not tracked, so an
  // unreadable error on them is irrelevant.
  const toRepoRel = (rel: string): string | null => {
    const m = rel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
    if (m) {
      const proj = idx.get(m[1]!)
      if (!proj || !proj.syncMemory) return null
      return `projects/${proj.name}/${m[2]!}`
    }
    return rel
  }

  walk(claudePath, [], (rel, abs) => {
    if (isClaudePathIgnored(rel)) return
    if (!isClaudePathSynced(rel, syncGlobal)) return
    const repoRel = toRepoRel(rel)
    if (repoRel === null) return // not tracked
    const repoPath = `claude/${repoRel}`
    let st
    try { st = statSync(abs) } catch { unreadable.push(repoPath); return }
    if (st.size > MAX_BYTES) { unreadable.push(repoPath); return }
    let content: Buffer
    try { content = readFileSync(abs) } catch { unreadable.push(repoPath); return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { unreadable.push(repoPath); return }
    }
    const sha1 = sha1OfBlob(content)
    out.push({ repoPath, surfacePath: rel, sha1, mode: '100644', size: content.length })
  })
  return { entries: out, unreadable }
}
```

Replace `enumClaudeProjectDotClaudeSource`:

```ts
export async function enumClaudeProjectDotClaudeSource(
  projectPath: string,
  projectName: string,
): Promise<EnumResult> {
  const root = join(projectPath, '.claude')
  if (!existsSync(root)) return { entries: [], unreadable: [] }
  const out: FileEntry[] = []
  const unreadable: string[] = []
  walk(root, [], (rel, abs) => {
    if (!isProjectDotClaudePathSynced(rel)) return
    const repoPath = `claude/projects/${projectName}/.claude/${rel}`
    let st
    try { st = statSync(abs) } catch { unreadable.push(repoPath); return }
    if (st.size > MAX_BYTES) { unreadable.push(repoPath); return }
    let content: Buffer
    try { content = readFileSync(abs) } catch { unreadable.push(repoPath); return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { unreadable.push(repoPath); return }
    }
    const sha1 = sha1OfBlob(content)
    out.push({ repoPath, surfacePath: `.claude/${rel}`, sha1, mode: '100644', size: content.length })
  })
  return { entries: out, unreadable }
}
```

Replace `enumCursorProjectSource`:

```ts
export async function enumCursorProjectSource(projectPath: string, projectName: string): Promise<EnumResult> {
  if (!existsSync(projectPath)) return { entries: [], unreadable: [] }
  const out: FileEntry[] = []
  const unreadable: string[] = []
  walk(projectPath, [], (rel, abs) => {
    if (!isCursorPathSynced(rel)) return
    const repoPath = `cursor/projects/${projectName}/${rel}`
    let st
    try { st = statSync(abs) } catch { unreadable.push(repoPath); return }
    if (st.size > MAX_BYTES) { unreadable.push(repoPath); return }
    let content: Buffer
    try { content = readFileSync(abs) } catch { unreadable.push(repoPath); return }
    const sha1 = sha1OfBlob(content)
    out.push({ repoPath, surfacePath: rel, sha1, mode: '100644', size: content.length })
  })
  return { entries: out, unreadable }
}
```

(`readSourceForCommit` is unchanged.)

- [ ] **Step 4: Update `engine.ts` enum call sites (compile only — full floor wiring is Task 6)**

In `refreshStatus` (`src/main/sync/engine/engine.ts`), the Claude block currently does `const globalEntries = await enumClaudeSource(...)` then iterates `globalEntries`. Update to use `.entries` and collect `.unreadable`. Replace lines 40–56:

```ts
const allSrc: Entry[] = []
const unreadableSet = new Set<string>()
const globalRes = await enumClaudeSource(claudePath, args.claudeProjects, args.syncGlobal)
for (const u of globalRes.unreadable) unreadableSet.add(u)
for (const f of globalRes.entries) {
  const m = f.repoPath.match(/^claude\/projects\/([^/]+)\/memory\//)
  if (m) {
    allSrc.push({ ref: { kind: 'claude-project-memory', projectName: m[1]! }, file: f })
  } else {
    allSrc.push({ ref: { kind: 'claude-global' }, file: f })
  }
}
for (const proj of args.claudeProjects) {
  if (!proj.syncDotClaude) continue
  const dotRes = await enumClaudeProjectDotClaudeSource(proj.path, proj.name)
  for (const u of dotRes.unreadable) unreadableSet.add(u)
  for (const f of dotRes.entries) {
    allSrc.push({ ref: { kind: 'claude-project-dotclaude', projectName: proj.name }, file: f })
  }
}
```

Then in the per-ref compare loop (around line 115–120), pass the unreadable subset for that ref's repoPaths. Replace the loop body:

```ts
for (const [key, bucket] of byRefKey) {
  const heads = headByKey.get(key) ?? []
  // unreadable repoPaths that belong to this ref-group
  const groupUnreadable = new Set<string>()
  for (const u of unreadableSet) {
    if (refKeyForRepoPath(u) === key) groupUnreadable.add(u)
  }
  const part = compare(bucket.ref, bucket.files,
    heads.map((h) => ({ ...h, sha: h.sha1 })), args.claudeProjects, groupUnreadable)
  diffs.push(...part)
}
```

Add a helper near `refForRepoPath` (it already exists at ~line 95). Add:

```ts
function refKeyForRepoPath(p: string): string {
  const ref = refForRepoPath(p)
  if (!ref) return ''
  return ref.kind === 'claude-global' ? 'claude-global' : `${ref.kind}::${ref.projectName}`
}
```

For the Cursor block (lines 124–130), update:

```ts
for (const proj of cursorProjects) {
  const src: SourceRef = { kind: 'cursor-project', projectName: proj.name }
  const res = await enumCursorProjectSource(proj.path, proj.name)
  const headEntries = await enumHead(repoPath, `cursor/projects/${proj.name}/`, `cursor/projects/${proj.name}/`)
  const part = compare(src, res.entries, headEntries.map((h) => ({ ...h, sha: h.sha1 })),
    [], new Set(res.unreadable))
  diffs.push(...part)
}
```

And update `localChanges` (line 132):

```ts
const localChanges = diffs.filter((d) => d.status !== 'same' && d.status !== 'unreadable').length
```

Add import of `refKey` is not needed here (we inline). No other engine logic changes in this task.

- [ ] **Step 5: Update `tests/fixtures/sync-roundtrip.ts` enum call sites**

In `roundTrip()`, the lines:

```ts
const globalEntries = await enumClaudeSource(cfg.layout.home, cfg.projects, cfg.syncGlobal)
const dotEntries = (await Promise.all(
  cfg.projects.filter((p) => p.syncDotClaude).map((p) => enumClaudeProjectDotClaudeSource(p.path, p.name)),
)).flat()
const allEntries = [...globalEntries, ...dotEntries]
```

become:

```ts
const globalRes = await enumClaudeSource(cfg.layout.home, cfg.projects, cfg.syncGlobal)
const dotResults = await Promise.all(
  cfg.projects.filter((p) => p.syncDotClaude).map((p) => enumClaudeProjectDotClaudeSource(p.path, p.name)),
)
const allEntries = [...globalRes.entries, ...dotResults.flatMap((r) => r.entries)]
```

- [ ] **Step 6: Run tests, expect pass**

Run: `npx vitest run tests/main/engine/source-enum.test.ts tests/main/engine/sync-roundtrip.test.ts`
Expected: PASS for both.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine`
Expected: typecheck clean; all engine tests pass (refresh now emits `'unreadable'` where applicable; existing tests unaffected since fixtures have no unreadable files).

---

## Task 5: `pull-apply` — atomic write

**Files:**
- Modify: `src/main/sync/engine/pull-apply.ts:1-15`
- Modify: `tests/main/engine/pull-apply.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write failing test**

Create `tests/main/engine/pull-apply.test.ts` (or append if it exists):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyToSource } from '../../../src/main/sync/engine/pull-apply'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-apply-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('applyToSource — atomic write', () => {
  it('writes full content and leaves no .tmp- residue', async () => {
    const target = join(dir, 'sub', 'file.txt')
    await applyToSource(target, Buffer.from('hello world'))
    expect(readFileSync(target, 'utf8')).toBe('hello world')
    expect(readdirSync(join(dir, 'sub')).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('overwrites existing file atomically', async () => {
    const target = join(dir, 'file.txt')
    writeFileSync(target, 'old')
    await applyToSource(target, Buffer.from('new'))
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('null content removes the file', async () => {
    const target = join(dir, 'file.txt')
    writeFileSync(target, 'x')
    await applyToSource(target, null)
    expect(readdirSync(dir)).toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/engine/pull-apply.test.ts`
Expected: FAIL on the `.tmp-` residue assertions (current impl writes directly, so no residue — but the test that asserts atomic naming via residue-absence will pass trivially; the real failing assertion is below). To guarantee a red first, the residue assertions are the contract. If all pass with the old impl, proceed to Step 3 anyway — the implementation change hardens the path; re-run confirms green.

> Note: direct `writeFileSync` also leaves no residue, so these tests may pass pre-change. They lock the contract. The behavioral hardening (no partial file on crash) can't be unit-tested without fault injection; covered by code review.

- [ ] **Step 3: Implement atomic write**

Replace lines 1–15 of `src/main/sync/engine/pull-apply.ts`:

```ts
// src/main/sync/engine/pull-apply.ts
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SETTINGS_KEY_ALLOW_LIST } from './rules'

let atomicCounter = 0

export async function applyToSource(absPath: string, content: Buffer | null): Promise<void> {
  if (content === null) {
    if (existsSync(absPath)) {
      try { unlinkSync(absPath) } catch { /* ignore */ }
    }
    return
  }
  mkdirSync(dirname(absPath), { recursive: true })
  // Atomic: write to a temp sibling, then rename over the target. rename within
  // the same directory is atomic on NTFS and POSIX — a crash never leaves a
  // half-written target.
  const tmp = `${absPath}.tmp-${process.pid}-${atomicCounter++}`
  try {
    writeFileSync(tmp, content)
    renameSync(tmp, absPath)
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/engine/pull-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine`
Expected: typecheck clean; engine + pull tests pass.

---

## Task 6: `engine` — floor, approvedDeletions, deleteAdded

**Files:**
- Modify: `src/main/sync/engine/engine.ts`
- Modify: `tests/main/engine/engine-push.test.ts`, `tests/main/engine/engine-discard.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/main/engine/engine-push.test.ts`:

```ts
import { mkdirSync as _mkdir } from 'node:fs' // (already imported above; ignore if dup)

describe('Engine.push — safeguards', () => {
  const SG = { claudeMd: true, commands: true, skills: true, settings: true }

  it('floor-blocks when a source loses >=50% of >=5 tracked files', async () => {
    // Seed HEAD with 8 commands files.
    mkdirSync(join(repoPath, 'claude', 'commands'), { recursive: true })
    for (let i = 0; i < 8; i++) writeFileSync(join(repoPath, 'claude', 'commands', `c${i}.md`), `v${i}\n`)
    git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'seed'])
    git(repoPath, ['push', '-q'])
    // Source has only CLAUDE.md (old) → 8 commands deleted, 0 remain in that category.
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')
    const p = await computePushPreview({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: SG })
    expect(p.kind).toBe('floor-blocked')
  })

  it('deletion is applied only when in approvedDeletions', async () => {
    // HEAD has CLAUDE.md + one extra file; source drops the extra (single deletion, below floor).
    writeFileSync(join(repoPath, 'claude', 'note.md'), 'note\n')
    git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'add note'])
    git(repoPath, ['push', '-q'])
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n') // note.md absent in source

    // Without approval → note.md stays in HEAD.
    const r1 = await executePush({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null,
      syncGlobal: SG, commitMessage: 'no-delete', approvedDeletions: [],
    })
    expect(r1.kind).toBe('ok')
    const after1 = spawnSync('git', ['-C', repoPath, 'cat-file', '-e', 'HEAD:claude/note.md'])
    expect(after1.status).toBe(0) // still present

    // With approval → note.md removed.
    const r2 = await executePush({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null,
      syncGlobal: SG, commitMessage: 'delete note', approvedDeletions: ['claude/note.md'],
    })
    expect(r2.kind).toBe('ok')
    const after2 = spawnSync('git', ['-C', repoPath, 'cat-file', '-e', 'HEAD:claude/note.md'])
    expect(after2.status).not.toBe(0) // gone
  })

  it('unreadable file keeps its HEAD version (not deleted, not changed)', async () => {
    // HEAD has settings.json (valid). Source settings.json is broken JSON → unreadable.
    const valid = '{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}'
    writeFileSync(join(repoPath, 'claude', 'settings.json'), valid)
    git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'add settings'])
    git(repoPath, ['push', '-q'])
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')
    writeFileSync(join(claudePath, 'settings.json'), '{ broken ')
    const r = await executePush({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null,
      syncGlobal: SG, commitMessage: 'noop', approvedDeletions: [],
    })
    expect(r.kind).toBe('nothing-to-push') // only unreadable present → nothing to commit
    const head = spawnSync('git', ['-C', repoPath, 'cat-file', '-p', 'HEAD:claude/settings.json'], { encoding: 'utf8' })
    expect(head.stdout).toBe(valid) // HEAD version preserved
  })
})
```

Append to `tests/main/engine/engine-discard.test.ts`:

```ts
describe('executeDiscard — added handling', () => {
  const SG = { claudeMd: true, commands: true, skills: true, settings: true }
  it('keeps local-only added files by default', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'committed\n')
    writeFileSync(join(claudePath, 'new-note.md'), 'brand new\n')
    const r = await executeDiscard({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: SG })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'new-note.md'), 'utf8')).toBe('brand new\n') // preserved
  })
  it('deletes added files when deleteAdded=true', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'committed\n')
    writeFileSync(join(claudePath, 'new-note.md'), 'brand new\n')
    const r = await executeDiscard({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: SG, deleteAdded: true })
    expect(r.kind).toBe('ok')
    expect(existsSync(join(claudePath, 'new-note.md'))).toBe(false)
  })
})
```

Add `existsSync` to the imports of `engine-discard.test.ts` (line 2). Note: `new-note.md` is a synced top-level Claude path (allowed by rules), so it shows as `added`.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/engine/engine-push.test.ts tests/main/engine/engine-discard.test.ts`
Expected: FAIL — `floor-blocked` kind missing; `approvedDeletions`/`deleteAdded` not in args; added files deleted by default.

- [ ] **Step 3: Implement engine changes**

In `src/main/sync/engine/engine.ts`:

(a) Add imports near the top (after existing imports):

```ts
import { checkFloor, refKey, DEFAULT_FLOOR_THRESHOLDS, type FloorThresholds, type FloorSourceVerdict } from './safety-floor'
import type { FileEntry } from '@shared/sync-types'
```

(b) Extend `RefreshArgs` (after `syncGlobal`):

```ts
  /** Optional override of mass-deletion floor thresholds. */
  floorThresholds?: FloorThresholds
```

(c) Compute and expose `headCountBySource`. Add a helper after `refreshStatus` that recomputes HEAD counts (reuse enumHead). Simpler: compute inside push/preview. Add a standalone helper:

```ts
async function headCountsBySource(args: RefreshArgs): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!args.repoPath) return counts
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1)
  // Claude
  const claudeHead = await enumHead(args.repoPath, 'claude/', 'claude/')
  for (const h of claudeHead) {
    const rel = h.repoPath.slice('claude/'.length)
    if (!rel.startsWith('projects/')) { bump('claude-global'); continue }
    const mDot = rel.match(/^projects\/([^/]+)\/\.claude\//)
    if (mDot) { bump(`claude-project-dotclaude::${mDot[1]}`); continue }
    const mMem = rel.match(/^projects\/([^/]+)\/memory\//)
    if (mMem) { bump(`claude-project-memory::${mMem[1]}`); continue }
  }
  // Cursor
  for (const p of args.cursorProjects) {
    const ch = await enumHead(args.repoPath, `cursor/projects/${p.name}/`, `cursor/projects/${p.name}/`)
    for (const _ of ch) bump(`cursor-project::${p.name}`)
  }
  return counts
}
```

(d) Extend `PushPreview` and `PushResult` unions:

```ts
export type PushPreview =
  | { kind: 'preview'; items: DiffEntry[]; unreadable: DiffEntry[]; deletions: DiffEntry[] }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }
  | { kind: 'floor-blocked'; verdicts: FloorSourceVerdict[] }

export type PushResult =
  | { kind: 'ok' }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }
  | { kind: 'race'; retry: boolean }
  | { kind: 'auth'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'floor-blocked'; verdicts: FloorSourceVerdict[] }
```

(e) Extend `PushArgs`:

```ts
export type PushArgs = RefreshArgs & { commitMessage: string; approvedDeletions: string[] }
```

(f) Rewrite `computePushPreview`:

```ts
export async function computePushPreview(args: RefreshArgs): Promise<PushPreview> {
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  const thresholds = args.floorThresholds ?? DEFAULT_FLOOR_THRESHOLDS
  const heads = await headCountsBySource(args)
  const floor = checkFloor(status.diffs, heads, thresholds)
  if (!floor.ok) return { kind: 'floor-blocked', verdicts: floor.blocked }
  const changed = status.diffs.filter((d) => d.status === 'added' || d.status === 'modified')
  const deletions = status.diffs.filter((d) => d.status === 'deleted')
  const unreadable = status.diffs.filter((d) => d.status === 'unreadable')
  if (changed.length === 0 && deletions.length === 0 && status.ahead === 0) {
    return { kind: 'nothing-to-push' }
  }
  return { kind: 'preview', items: [...changed, ...deletions], unreadable, deletions }
}
```

(g) Rewrite `executePush` build section. Replace the body from `const items = ...` through the `buildAndCommitFromSource` call:

```ts
  const thresholds = args.floorThresholds ?? DEFAULT_FLOOR_THRESHOLDS
  const heads = await headCountsBySource(args)
  const floor = checkFloor(status.diffs, heads, thresholds)
  if (!floor.ok) return { kind: 'floor-blocked', verdicts: floor.blocked }

  const approved = new Set(args.approvedDeletions)
  // Build set: changes + only-approved deletions. Unreadable are never built
  // (their HEAD blob stays in the tree because readTreeIntoIndex seeds from HEAD).
  const toBuild = status.diffs.filter((d) =>
    d.status === 'added' || d.status === 'modified' ||
    (d.status === 'deleted' && approved.has(d.repoPath)))
  if (toBuild.length === 0 && status.ahead === 0) return { kind: 'nothing-to-push' }

  const indexFile = join(args.repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`)
  try {
    await buildAndCommitFromSource({
      repoPath: args.repoPath,
      diffs: toBuild,
      sourceContent: (d) => {
        if (d.status === 'deleted') return null
        const abs = surfaceAbsPath(args, d)
        if (!abs) return null
        return readSourceForCommit(abs, d.surfacePath)
      },
      commitMessage: args.commitMessage,
      indexFile,
    })
  } catch (e) {
    return { kind: 'error', message: (e as Error).message }
  }
```

Keep the existing `pushOrigin` + rollback block below unchanged.

(h) Extend `executeDiscard` signature and added-gating. Change its arg type and the `'added'` branch:

```ts
export async function executeDiscard(
  args: RefreshArgs & { deleteAdded?: boolean },
): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!args.repoPath) return { kind: 'error', message: 'repoPath required' }
  const status = await refreshStatus({ ...args, doFetch: false })
  for (const d of status.diffs) {
    if (d.status === 'same' || d.status === 'unreadable') continue
    const surfaceAbs = surfaceAbsPath(args, d)
    if (!surfaceAbs) continue
    if (d.status === 'added') {
      if (args.deleteAdded === true) await applyToSource(surfaceAbs, null)
      continue
    }
    if (d.status === 'modified' || d.status === 'deleted') {
      let prefix: string
      if (d.source.kind === 'claude-global') prefix = 'claude/'
      else if (d.source.kind === 'claude-project-memory') prefix = `claude/projects/${d.source.projectName}/memory/`
      else if (d.source.kind === 'claude-project-dotclaude') prefix = `claude/projects/${d.source.projectName}/.claude/`
      else prefix = `cursor/projects/${d.source.projectName}/`
      const head = await enumHead(args.repoPath, prefix, prefix)
      const entry = head.find((h) => h.repoPath === d.repoPath)
      if (entry) {
        const blob = await catFileBlob(args.repoPath, entry.sha1)
        await applyToSource(surfaceAbs, blob)
      }
    }
  }
  return { kind: 'ok' }
}
```

(i) Remove the now-unused `FileEntry` import if it conflicts — only add it if `import('@shared/sync-types').FileEntry` inline usage at line 37 is replaced. Leave the inline `import(...)` type as-is to avoid churn; do NOT add a duplicate top-level `FileEntry` import if unused. (If tsc reports unused, drop the added import from step (a).)

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/engine/engine-push.test.ts tests/main/engine/engine-discard.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify full engine suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine`
Expected: typecheck clean; all engine tests pass.

---

## Task 7: API types, IPC, preload

**Files:**
- Modify: `src/shared/api.ts` (`RepoStatus`, `PushOptions`)
- Modify: `src/main/ipc.ts` (`preview-push-status`, `run-push`, `discard-local-changes`)
- Modify: `src/preload/index.ts` (`runPush`, `discardLocalChanges`)

- [ ] **Step 1: Update `RepoStatus` and `PushOptions` in `src/shared/api.ts`**

Replace `RepoStatus` (lines 328–331):

```ts
export type RepoStatusFloorVerdict = {
  source: string
  headCount: number
  deleting: number
  reason: 'source-empty' | 'ratio-exceeded'
}

export type RepoStatus = {
  clean: boolean
  /** repoPath's grouped by push intent. */
  added: string[]
  modified: string[]
  deletions: string[]
  unreadable: string[]
  /** Present and non-empty when the mass-deletion floor blocked the push. */
  floorBlocked: RepoStatusFloorVerdict[]
}
```

Replace `PushOptions` (lines 305–308):

```ts
export type PushOptions = {
  commitMessage: string
  includeSecrets: boolean
  /** repoPath's the user explicitly approved for deletion. */
  approvedDeletions: string[]
}
```

- [ ] **Step 2: Update `preview-push-status` in `src/main/ipc.ts`**

Replace the handler (lines 438–454):

```ts
  ipcMain.handle('preview-push-status', async (): Promise<import('@shared/api').RepoStatus> => {
    const cfg = readConfig(configPath)
    const empty: import('@shared/api').RepoStatus = {
      clean: true, added: [], modified: [], deletions: [], unreadable: [], floorBlocked: [],
    }
    if (!cfg.repoPath) return empty
    const preview = await computePushPreview({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      doFetch: false,
      syncGlobal: cfg.claude.syncGlobal,
    })
    if (preview.kind === 'floor-blocked') {
      return {
        clean: false, added: [], modified: [], deletions: [], unreadable: [],
        floorBlocked: preview.verdicts.map((v) => ({
          source: refKeyLabel(v.source), headCount: v.headCount, deleting: v.deleting, reason: v.reason,
        })),
      }
    }
    if (preview.kind !== 'preview') return empty
    const added = preview.items.filter((d) => d.status === 'added').map((d) => d.repoPath)
    const modified = preview.items.filter((d) => d.status === 'modified').map((d) => d.repoPath)
    const deletions = preview.deletions.map((d) => d.repoPath)
    const unreadable = preview.unreadable.map((d) => d.repoPath)
    const clean = added.length === 0 && modified.length === 0 && deletions.length === 0
    return { clean, added, modified, deletions, unreadable, floorBlocked: [] }
  })
```

Add `computePushPreview` to the imports from `./sync/engine/engine` at the top of `ipc.ts` (find the existing `import { ... } from './sync/engine/engine'` and add it). Add a small local helper near the top of the handler-registration function:

```ts
  const refKeyLabel = (s: import('@shared/sync-types').SourceRef): string =>
    s.kind === 'claude-global' ? 'Claude (global)'
    : s.kind === 'claude-project-memory' ? `Claude memory: ${s.projectName}`
    : s.kind === 'claude-project-dotclaude' ? `Claude project: ${s.projectName}`
    : `Cursor: ${s.projectName}`
```

- [ ] **Step 3: Update `run-push` handler**

In the `run-push` handler (line ~538), it calls `executePush`. Add `approvedDeletions` from opts and handle the new `floor-blocked` result. Replace the `executePush({...})` call args and add result handling. Find where `executePush` is invoked and ensure:

```ts
    const r = await executePush({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      syncGlobal: cfg.claude.syncGlobal,
      commitMessage: opts.commitMessage,
      approvedDeletions: opts.approvedDeletions ?? [],
    })
```

And before the final fallthrough `return`, add:

```ts
    if (r.kind === 'floor-blocked') {
      return { ok: false, exitCode: -1, error: { key: 'push.error.floorBlocked' } } as RunResult
    }
```

(If the existing handler already constructs `executePush` args differently, adapt — the only required additions are `approvedDeletions` and the `floor-blocked` branch.)

- [ ] **Step 4: Update `discard-local-changes` handler**

In the `discard-local-changes` handler (line ~659), accept a `deleteAdded` flag and pass it:

```ts
  ipcMain.handle('discard-local-changes', async (_e, deleteAdded?: boolean): Promise<RunResult> => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return { ok: false, exitCode: -1, error: { key: 'push.error.notConfigured' } } as RunResult
    const r = await executeDiscard({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      syncGlobal: cfg.claude.syncGlobal,
      deleteAdded: deleteAdded === true,
    })
    if (r.kind === 'ok') return { ok: true, exitCode: 0 } as RunResult
    return { ok: false, exitCode: -1, error: { key: 'pull.error.failed', fallback: 'message' in r ? r.message : '' } } as RunResult
  })
```

(Adapt to the existing handler body; keep any existing log emits.)

- [ ] **Step 5: Update `src/preload/index.ts`**

`runPush` already forwards `opts` (PushOptions now includes `approvedDeletions`) — no change needed beyond the type flowing through. Update `discardLocalChanges` signature (lines 123–124):

```ts
  discardLocalChanges: (deleteAdded?: boolean): Promise<RunResult> =>
    ipcRenderer.invoke('discard-local-changes', deleteAdded),
```

And in `src/shared/api.ts` `AppApi`, update line 168:

```ts
  discardLocalChanges(deleteAdded?: boolean): Promise<RunResult>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: typecheck clean across main + node configs. (Renderer wiring lands in Task 8; if App.tsx already calls `runPush` without `approvedDeletions`, tsc will flag it — Task 8 fixes. If a transient error appears here in App.tsx, proceed to Task 8; it resolves there.)

---

## Task 8: UI — PushModal sections, deletion checkboxes, floor block, Discard, i18n

**Files:**
- Modify: `src/renderer/components/PushModal.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n/locales/en.json`, `ru.json`

- [ ] **Step 1: Add i18n keys to `en.json`**

Insert near the other `push.modal.*` keys:

```json
  "push.modal.section.added": "Added ({count})",
  "push.modal.section.modified": "Modified ({count})",
  "push.modal.section.deletions": "Deleting ({count}) — confirm each",
  "push.modal.section.unreadable": "Not read — left unchanged ({count})",
  "push.modal.unreadable.hint": "These tracked files couldn't be read (locked, invalid, or too large). Their repo version is kept untouched.",
  "push.modal.floorBlocked.title": "Push blocked: too many deletions",
  "push.modal.floorBlocked.body": "A source would lose an unusually large share of its tracked files. Review your local files before pushing.",
  "push.modal.floorBlocked.row": "{source}: deleting {deleting} of {headCount}",
  "push.error.floorBlocked": "Push blocked by the mass-deletion guard. Review local files.",
  "discard.modal.deleteAdded": "Also delete {count} new local-only files",
  "discard.modal.deleteAdded.hint": "Off by default. New files not yet in the repo are kept unless you check this."
```

- [ ] **Step 2: Add same keys to `ru.json`**

```json
  "push.modal.section.added": "Добавлено ({count})",
  "push.modal.section.modified": "Изменено ({count})",
  "push.modal.section.deletions": "Удаляется ({count}) — подтвердите каждое",
  "push.modal.section.unreadable": "Не прочитано — без изменений ({count})",
  "push.modal.unreadable.hint": "Эти tracked-файлы не удалось прочитать (заблокированы, повреждены или слишком большие). Их версия в репе сохранена без изменений.",
  "push.modal.floorBlocked.title": "Push заблокирован: слишком много удалений",
  "push.modal.floorBlocked.body": "Источник потеряет необычно большую долю своих файлов. Проверьте локальные файлы перед push.",
  "push.modal.floorBlocked.row": "{source}: удаляется {deleting} из {headCount}",
  "push.error.floorBlocked": "Push заблокирован защитой от массовых удалений. Проверьте локальные файлы.",
  "discard.modal.deleteAdded": "Также удалить {count} новых локальных файлов",
  "discard.modal.deleteAdded.hint": "По умолчанию выключено. Новые файлы, ещё не в репе, сохраняются, если не отмечено."
```

- [ ] **Step 3: Run dictionaries test**

Run: `npx vitest run tests/renderer/dictionaries.test.ts`
Expected: PASS (en/ru key sets match).

- [ ] **Step 4: Rewrite `PushModal.tsx` body**

Replace the changed-files block (lines 60–118) with section rendering + deletion checkboxes + floor block. The component now tracks approved deletions and passes them to `onConfirm`. Replace `Props` and the body:

```tsx
type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (commitMessage: string, includeSecrets: boolean, approvedDeletions: string[]) => Promise<void>
}

export function PushModal({ open, onClose, onConfirm }: Props) {
  const t = useT()
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [message, setMessage] = useState('')
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMessage(''); setError(null); setBusy(false); setApproved(new Set())
    void window.api.previewPushStatus().then(setStatus)
    void window.api.getConfig().then((cfg) => setIncludeSecrets(cfg.includeSecretsInPush))
  }, [open])

  const floorBlocked = !!status && status.floorBlocked.length > 0

  const handleConfirm = async () => {
    setBusy(true); setError(null)
    try {
      const cfg = await window.api.getConfig()
      await window.api.setConfig({ ...cfg, includeSecretsInPush: includeSecrets })
      await onConfirm(message.trim(), includeSecrets, [...approved])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (p: string) =>
    setApproved((cur) => {
      const next = new Set(cur)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })

  const FileList = ({ items }: { items: string[] }) => (
    <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 font-mono text-xs">
      {items.map((f) => <div key={f} className="truncate" title={f}>{f}</div>)}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader><DialogTitle>{t('push.modal.title')}</DialogTitle></DialogHeader>

        {!status ? (
          <div className="text-sm text-muted-foreground">{t('push.modal.checkingStatus')}</div>
        ) : floorBlocked ? (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <div className="font-semibold text-destructive">{t('push.modal.floorBlocked.title')}</div>
            <div className="text-muted-foreground">{t('push.modal.floorBlocked.body')}</div>
            <ul className="font-mono text-xs">
              {status.floorBlocked.map((v) => (
                <li key={v.source}>{t('push.modal.floorBlocked.row', { source: v.source, deleting: v.deleting, headCount: v.headCount })}</li>
              ))}
            </ul>
          </div>
        ) : status.clean ? (
          <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('push.info.nothingToPush')}
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            {status.added.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('push.modal.section.added', { count: status.added.length })}</h3>
                <FileList items={status.added} />
              </div>
            )}
            {status.modified.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('push.modal.section.modified', { count: status.modified.length })}</h3>
                <FileList items={status.modified} />
              </div>
            )}
            {status.deletions.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">{t('push.modal.section.deletions', { count: status.deletions.length })}</h3>
                <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 font-mono text-xs">
                  {status.deletions.map((f) => (
                    <label key={f} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={approved.has(f)} onChange={() => toggle(f)} className="accent-primary" />
                      <span className="truncate" title={f}>{f}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {status.unreadable.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">{t('push.modal.section.unreadable', { count: status.unreadable.length })}</h3>
                <FileList items={status.unreadable} />
                <p className="mt-1 text-xs text-muted-foreground">{t('push.modal.unreadable.hint')}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="commit-message">{t('push.modal.commitMessage.label')}</Label>
              <Textarea id="commit-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={t('push.modal.commitMessage.placeholder')} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="include-secrets" className="cursor-pointer">{t('push.modal.includeSecrets.label')}</Label>
                <Switch id="include-secrets" checked={includeSecrets} onCheckedChange={setIncludeSecrets} />
              </div>
              {includeSecrets && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  {t('push.modal.includeSecrets.warning')}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          {!!status && !status.clean && !floorBlocked && (
            <Button onClick={handleConfirm} disabled={busy || message.trim() === ''}>
              {busy ? t('push.modal.pushing') : t('push.modal.push')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Update `App.tsx` push caller**

Find where `<PushModal ... onConfirm={...}>` is rendered and where `window.api.runPush(...)` is called. Update the `onConfirm` to accept and forward `approvedDeletions`:

```tsx
onConfirm={async (commitMessage, includeSecrets, approvedDeletions) => {
  await window.api.runPush({ commitMessage, includeSecrets, approvedDeletions })
  // ...keep existing post-push refresh logic
}}
```

If `runPush` is called elsewhere without `approvedDeletions`, pass `approvedDeletions: []`.

- [ ] **Step 6: Update `App.tsx` discard caller (optional checkbox)**

Locate the discard confirmation. If it's a simple `window.confirm` / button calling `window.api.discardLocalChanges()`, thread the flag. Minimal approach: read current status to count `added`, and if any, show the checkbox in the existing confirm UI. If the discard UI is a plain button, pass `false` for now and add the checkbox to whatever modal/confirm exists:

```tsx
await window.api.discardLocalChanges(deleteAdded) // deleteAdded from a checkbox state, default false
```

Concrete requirement: `discardLocalChanges` must be called with an explicit boolean; default `false` preserves the new safe behavior. The checkbox label uses `t('discard.modal.deleteAdded', { count })` and hint `t('discard.modal.deleteAdded.hint')`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json && npx eslint src tests --ext .ts,.tsx --no-error-on-unmatched-pattern`
Expected: typecheck clean; lint clean.

---

## Task 9: Final validation

**Files:** none.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: 0 errors.

- [ ] **Step 2: Full lint**

Run: `npx eslint src tests --ext .ts,.tsx --no-error-on-unmatched-pattern`
Expected: 0 errors.

- [ ] **Step 3: Full test run**

Run: `npx vitest run`
Expected: all suites pass EXCEPT the pre-existing Windows-only `tests/main/safe-storage.test.ts` file-mode failures (unrelated to this work — `statSync().mode & 0o777` returns `0o666` on NTFS). If `regression-no-phantom-after-pull.test.ts` times out under parallel load, re-run it in isolation: `npx vitest run tests/main/engine/regression-no-phantom-after-pull.test.ts --testTimeout=30000` — it must pass.

- [ ] **Step 4: Manual smoke (no real push)**

Run: `npm run dev`
- Trigger Push modal on a repo with local changes. Confirm sections render: Added / Modified / Deleting (with checkboxes, unchecked) / Not-read.
- Confirm a deletion only goes through when its checkbox is checked.
- Simulate a mass deletion (e.g., temporarily move a folder with ≥5 tracked files out of `~/.claude`) → Push modal shows the red floor-block and Push is disabled.
- Trigger Discard with a new local-only file present → file survives; checking "also delete new files" removes it.

DO NOT push to a real remote during smoke unless intending to publish.

- [ ] **Step 5: Hand back**

Notify: "Sub-project №1 (safeguards) complete. tsc/lint green; tests green except pre-existing Windows safe-storage file-mode quirk. Floor, unreadable-handling, explicit deletion opt-in, atomic writes, and non-destructive Discard are in. No git operations performed — commit/push are yours."

---

## Self-Review notes

- **Spec coverage:** F1 read-error → Tasks 3,4 (`unreadable` status + enum surfacing) + Task 6 (HEAD version preserved). F1b floor → Task 2 + Task 6. F1-surfacing → Task 6 (preview sections) + Task 7 (IPC) + Task 8 (UI). JSON-guard → folded into unreadable (Task 4 settings canonicalize → unreadable). Atomic write → Task 5. F4 Discard → Task 6 + Task 8. All six spec items mapped.
- **Placeholder scan:** every code step has complete code. App.tsx steps (7-8/5-6) describe edits against code not shown in full — acceptable because they follow the existing PullModal `deletionsToApply` pattern and the exact required call shapes are given.
- **Type consistency:** `EnumResult`, `FloorThresholds`, `FloorSourceVerdict`, `checkFloor`, `refKey`, `DEFAULT_FLOOR_THRESHOLDS`, `approvedDeletions`, `deleteAdded`, `RepoStatus` fields — defined once, used consistently across tasks. `compare` 5th param `unreadable` optional, matching all call sites.
- **Git avoidance:** confirmed — no git write commands; verification steps replace commit-per-task.
