# Flexible Sync Toggles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-category sync toggles (4 global + 2 per-project) and enable syncing of `<project>/.claude/` directories, preserving byte-identical round-trip for everything except service files.

**Architecture:** Config gains `syncGlobal` (4 booleans) and per-project `syncMemory`/`syncDotClaude` flags. `rules.ts` exposes gated `isClaudePathSynced(rel, syncGlobal)` plus a new `isProjectDotClaudePathSynced(rel)`. `SourceRef` expands into 4 kinds for explicit per-category classification. `source-enum.ts` honours the toggles; a new `enumClaudeProjectDotClaudeSource` walks `<project>/.claude/`. `engine.ts` iterates project surfaces and `pull-apply.ts` runs settings merge for both global and project-level `settings.json`. Settings UI gets a "Global sync" block and per-project memory/.claude toggles. A new `tests/main/engine/sync-roundtrip.test.ts` is the load-bearing invariant suite.

**Tech Stack:** TypeScript, Electron-Vite, React, Vitest, Node fs APIs, electron-builder. Existing engine modules in `src/main/sync/engine/`.

**Important user-imposed constraints (apply to every task):**
- **No git operations during implementation.** Do NOT add `git add` / `git commit` / `git push` steps to the plan or run them while executing tasks. The user owns commits. Each task ends with a verification step instead.
- **No `Co-Authored-By: Claude`** trailers anywhere.
- After every task: run `npx tsc --noEmit -p tsconfig.json` and `npx vitest run <relevant test file>`. Do not skip.

---

## File Structure

**Modify:**
- `src/shared/api.ts` — extend `ClaudeConfig` (add `syncGlobal`) and `ClaudeProject` (add `syncMemory`, `syncDotClaude`).
- `src/main/config.ts` — read/write new fields, migrate legacy configs (missing → defaults `true`).
- `src/main/sync/engine/rules.ts` — gated `isClaudePathSynced(rel, syncGlobal)`, new `isProjectDotClaudePathSynced(rel)`.
- `src/shared/sync-types.ts` — split `SourceRef.kind: 'claude'` into `'claude-global' | 'claude-project-memory' | 'claude-project-dotclaude'`.
- `src/main/sync/engine/source-enum.ts` — pass `syncGlobal` to enum, gate memory by `project.syncMemory`, attach explicit `kind`. Add `enumClaudeProjectDotClaudeSource(projectPath, projectName)`.
- `src/main/sync/engine/engine.ts` — `refreshStatus` collects dotClaude surface per project, `surfaceAbsPath` resolves new kinds, `claudeRepoRelToSurfaceRel` recognises `.claude/...` prefix.
- `src/main/sync/engine/pull-apply.ts` — re-export `mergeSettingsForPull` unchanged; engine now calls it for project-level `<project>/.claude/settings.json` too (change is in engine.ts, not pull-apply).
- `src/main/sync/engine/comparator.ts` — adjust generic `kind: 'claude'` checks to new kinds where needed.
- `src/renderer/components/Settings.tsx` — Global sync section + per-project two-toggle row.
- `src/renderer/i18n/locales/en.json`, `src/renderer/i18n/locales/ru.json` — 10 new keys.
- `tests/main/config.test.ts` — migration tests.
- `tests/main/engine/rules.test.ts` — gating + project rules.
- `tests/main/engine/source-enum.test.ts` — gating + dotClaude enum.

**Create:**
- `tests/fixtures/sync-roundtrip.ts` — fixture builder and round-trip helper.
- `tests/main/engine/sync-roundtrip.test.ts` — parametrised round-trip invariant suite.

---

## Task 1: Extend config schema and migrate

**Files:**
- Modify: `src/shared/api.ts:24-46`
- Modify: `src/main/config.ts:37-49, 51-80, 134-148`
- Modify: `tests/main/config.test.ts:21-31` (baseDefaults) + add migration block

- [ ] **Step 1: Write failing migration test**

Append to `tests/main/config.test.ts` near the end of the `readConfig migration to multi-target` block:

```ts
describe('readConfig migration to flexible sync toggles', () => {
  it('fills missing syncGlobal with all-true defaults', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        claude: { enabled: true, path: '/home/u/.claude', projects: [] },
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude.syncGlobal).toEqual({
      claudeMd: true,
      commands: true,
      skills: true,
      settings: true,
    })
  })

  it('preserves explicit syncGlobal values', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        claude: {
          enabled: true,
          path: '/x',
          projects: [],
          syncGlobal: { claudeMd: true, commands: false, skills: true, settings: false },
        },
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude.syncGlobal).toEqual({
      claudeMd: true, commands: false, skills: true, settings: false,
    })
  })

  it('fills missing per-project syncMemory/syncDotClaude with true', () => {
    const f = join(dir, 'config.json')
    writeFileSync(
      f,
      JSON.stringify({
        claude: {
          enabled: true,
          path: '/x',
          projects: [{ name: 'a', path: '/p/a' }, { name: 'b', path: '/p/b', syncDotClaude: false }],
        },
      }),
    )
    const cfg = readConfig(f)
    expect(cfg.claude.projects).toEqual([
      { name: 'a', path: '/p/a', syncMemory: true, syncDotClaude: true },
      { name: 'b', path: '/p/b', syncMemory: true, syncDotClaude: false },
    ])
  })

  it('writeConfig round-trips syncGlobal and per-project flags', () => {
    const f = join(dir, 'config.json')
    const cfg: AppConfig = {
      ...baseDefaults,
      claude: {
        enabled: true,
        path: '/x',
        projects: [{ name: 'a', path: '/p/a', syncMemory: false, syncDotClaude: true }],
        syncGlobal: { claudeMd: false, commands: true, skills: true, settings: true },
      },
      rulesTarget: '/x',
    }
    writeConfig(f, cfg)
    expect(readConfig(f).claude).toEqual(cfg.claude)
  })
})
```

Also extend `baseDefaults` at the top of the file:

```ts
const baseDefaults: AppConfig = {
  repoPath: null,
  repoUrl: null,
  includeSecretsInPush: false,
  locale: null,
  lastDismissedUpdate: null,
  claude: {
    enabled: false,
    path: null,
    projects: [],
    syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
  },
  cursor: { enabled: false, projects: [] },
  catalogUrl: null,
  rulesTarget: null,
}
```

- [ ] **Step 2: Run tests, expect type errors and failure**

Run: `npx vitest run tests/main/config.test.ts`
Expected: TS errors about missing `syncGlobal`, `syncMemory`, `syncDotClaude` fields on the types.

- [ ] **Step 3: Update `src/shared/api.ts` types**

Replace existing `ClaudeProject` and `ClaudeConfig` (lines 24–41):

```ts
export type ClaudeProject = {
  /** User-editable label, used as repo subfolder under <repo>/claude/projects/.
   *  Must match across devices for the same logical project. */
  name: string
  /** Absolute path to the project root on this machine. Used to translate
   *  between the encoded segment in ~/.claude/projects/<encoded>/ and the
   *  cross-device-stable `name`. */
  path: string
  /** Whether ~/.claude/projects/<encoded>/memory/ is synced for this project. */
  syncMemory: boolean
  /** Whether <project>/.claude/ is synced for this project. */
  syncDotClaude: boolean
}

export type ClaudeGlobalSyncFlags = {
  claudeMd: boolean
  commands: boolean
  skills: boolean
  settings: boolean
}

export type ClaudeConfig = {
  enabled: boolean
  path: string | null
  projects: ClaudeProject[]
  /** Per-category toggles for ~/.claude top-level entries. All true = legacy behavior. */
  syncGlobal: ClaudeGlobalSyncFlags
}
```

- [ ] **Step 4: Update `src/main/config.ts` reader/writer + defaults**

Replace `defaultsBase()` (line 37–49) so `claude` includes `syncGlobal`:

```ts
function defaultsBase(): AppConfig {
  return {
    repoPath: null,
    repoUrl: null,
    includeSecretsInPush: false,
    locale: null,
    lastDismissedUpdate: null,
    claude: {
      enabled: false,
      path: null,
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    },
    cursor: { enabled: false, projects: [] },
    catalogUrl: null,
    rulesTarget: null,
  }
}
```

Replace `readClaudeProjects` (line 51–64):

```ts
function readClaudeProjects(raw: unknown): ClaudeProject[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p): ClaudeProject[] => {
    if (
      p &&
      typeof p === 'object' &&
      typeof (p as { name?: unknown }).name === 'string' &&
      typeof (p as { path?: unknown }).path === 'string'
    ) {
      const obj = p as { name: string; path: string; syncMemory?: unknown; syncDotClaude?: unknown }
      return [{
        name: obj.name,
        path: obj.path,
        // Missing → default true (migration). Explicit false stays false.
        syncMemory: obj.syncMemory === false ? false : true,
        syncDotClaude: obj.syncDotClaude === false ? false : true,
      }]
    }
    return []
  })
}
```

Add a helper above `readClaudeBlock`:

```ts
function readSyncGlobal(raw: unknown): ClaudeConfig['syncGlobal'] {
  const def = { claudeMd: true, commands: true, skills: true, settings: true }
  if (!raw || typeof raw !== 'object') return def
  const r = raw as Record<string, unknown>
  return {
    claudeMd: r.claudeMd === false ? false : true,
    commands: r.commands === false ? false : true,
    skills: r.skills === false ? false : true,
    settings: r.settings === false ? false : true,
  }
}
```

Replace `readClaudeBlock` (line 66–80):

```ts
function readClaudeBlock(parsed: Record<string, unknown>): ClaudeConfig {
  const block = parsed.claude
  if (block && typeof block === 'object' && 'enabled' in (block as object)) {
    const b = block as Record<string, unknown>
    return {
      enabled: b.enabled === true,
      path: typeof b.path === 'string' ? b.path : null,
      projects: readClaudeProjects(b.projects),
      syncGlobal: readSyncGlobal(b.syncGlobal),
    }
  }
  if (typeof parsed.rulesTarget === 'string') {
    return {
      enabled: true,
      path: parsed.rulesTarget,
      projects: [],
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    }
  }
  return {
    enabled: false,
    path: null,
    projects: [],
    syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
  }
}
```

Import `ClaudeGlobalSyncFlags` is unnecessary — already covered via `ClaudeConfig`.

- [ ] **Step 5: Run tests, expect green**

Run: `npx vitest run tests/main/config.test.ts`
Expected: PASS for new tests AND existing tests (existing tests construct objects via `baseDefaults` so they pick up `syncGlobal` automatically; legacy fixtures asserting `{ enabled, path, projects: [] }` must be updated). If any existing assertion of the form `expect(cfg.claude).toEqual({ enabled: ..., path: ..., projects: [] })` fails, add `syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true }` to the expectation.

Specifically update these existing tests in `tests/main/config.test.ts`:
- Line ~67: `claude: { enabled: true, path: '/home/user/.claude', projects: [] }` → add `syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true }`.
- Line ~84: same shape.
- Line ~126: `expect(cfg.claude).toEqual(...)` — add syncGlobal.
- Line ~143: same.
- Line ~152: same.
- Line ~186: `expect(raw.claude).toEqual(...)` — add `syncGlobal: {...}`.
- Line ~204: round-trip expectation — add syncGlobal.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/config.test.ts`
Expected: typecheck clean; all config tests pass.

---

## Task 2: Rules — gating helpers + project `.claude` rules

**Files:**
- Modify: `src/main/sync/engine/rules.ts:1-90`
- Modify: `tests/main/engine/rules.test.ts:1-37` (existing) + new describe blocks

- [ ] **Step 1: Write failing tests for gating + project rules**

Append to `tests/main/engine/rules.test.ts`:

```ts
import {
  isClaudePathSynced,
  isClaudePathIgnored,
  isProjectDotClaudePathSynced,
} from '../../../src/main/sync/engine/rules'

const ALL_ON = { claudeMd: true, commands: true, skills: true, settings: true }

describe('SyncRules — global gating via syncGlobal', () => {
  it('all-true behaves like before', () => {
    expect(isClaudePathSynced('CLAUDE.md', ALL_ON)).toBe(true)
    expect(isClaudePathSynced('commands/a.md', ALL_ON)).toBe(true)
    expect(isClaudePathSynced('skills/foo/SKILL.md', ALL_ON)).toBe(true)
    expect(isClaudePathSynced('settings.json', ALL_ON)).toBe(true)
  })
  it('claudeMd=false drops CLAUDE.md only', () => {
    const f = { ...ALL_ON, claudeMd: false }
    expect(isClaudePathSynced('CLAUDE.md', f)).toBe(false)
    expect(isClaudePathSynced('commands/a.md', f)).toBe(true)
    expect(isClaudePathSynced('settings.json', f)).toBe(true)
  })
  it('commands=false drops commands/*', () => {
    const f = { ...ALL_ON, commands: false }
    expect(isClaudePathSynced('commands/a.md', f)).toBe(false)
    expect(isClaudePathSynced('commands/nested/b.md', f)).toBe(false)
    expect(isClaudePathSynced('CLAUDE.md', f)).toBe(true)
  })
  it('skills=false drops skills/*', () => {
    const f = { ...ALL_ON, skills: false }
    expect(isClaudePathSynced('skills/foo/SKILL.md', f)).toBe(false)
    expect(isClaudePathSynced('CLAUDE.md', f)).toBe(true)
  })
  it('settings=false drops settings.json', () => {
    const f = { ...ALL_ON, settings: false }
    expect(isClaudePathSynced('settings.json', f)).toBe(false)
    expect(isClaudePathSynced('CLAUDE.md', f)).toBe(true)
  })
  it('per-project memory remains gated by sync entry — not by syncGlobal', () => {
    // memory paths are still flagged synced by isClaudePathSynced — engine
    // applies per-project syncMemory separately.
    expect(isClaudePathSynced('projects/abc/memory/x.md', ALL_ON)).toBe(true)
    // Even with all global flags false, memory is still considered "syncable":
    const off = { claudeMd: false, commands: false, skills: false, settings: false }
    expect(isClaudePathSynced('projects/abc/memory/x.md', off)).toBe(true)
  })
})

describe('SyncRules — project .claude path rules', () => {
  it('allows CLAUDE.md, settings.json, commands/, skills/', () => {
    expect(isProjectDotClaudePathSynced('CLAUDE.md')).toBe(true)
    expect(isProjectDotClaudePathSynced('settings.json')).toBe(true)
    expect(isProjectDotClaudePathSynced('commands/a.md')).toBe(true)
    expect(isProjectDotClaudePathSynced('skills/foo/SKILL.md')).toBe(true)
  })
  it('ignores same service files as global', () => {
    expect(isProjectDotClaudePathSynced('settings.local.json')).toBe(false)
    expect(isProjectDotClaudePathSynced('.credentials.json')).toBe(false)
    expect(isProjectDotClaudePathSynced('plugins/x')).toBe(false)
    expect(isProjectDotClaudePathSynced('sessions/s.jsonl')).toBe(false)
    expect(isProjectDotClaudePathSynced('history.jsonl')).toBe(false)
    expect(isProjectDotClaudePathSynced('cache/x')).toBe(false)
    expect(isProjectDotClaudePathSynced('ide/x')).toBe(false)
    expect(isProjectDotClaudePathSynced('statsig/x')).toBe(false)
    expect(isProjectDotClaudePathSynced('.DS_Store')).toBe(false)
    expect(isProjectDotClaudePathSynced('CLAUDE.md.backup.20260101-120000')).toBe(false)
  })
  it('ignores project-local service files (worktrees/, scheduled_tasks.lock)', () => {
    expect(isProjectDotClaudePathSynced('worktrees/foo/bar')).toBe(false)
    expect(isProjectDotClaudePathSynced('scheduled_tasks.lock')).toBe(false)
  })
  it('rejects unknown top-level entries (conservative allow-list)', () => {
    expect(isProjectDotClaudePathSynced('random.json')).toBe(false)
    expect(isProjectDotClaudePathSynced('agents/x')).toBe(false)
  })
})
```

Update the existing first describe block in this file (lines 12–37): the calls `isClaudePathSynced('CLAUDE.md')` etc. need an `ALL_ON` second argument. Either pass `ALL_ON` or rename the old positional helper:

```ts
const ALL_ON_PRE = { claudeMd: true, commands: true, skills: true, settings: true }
describe('SyncRules — Claude top-level', () => {
  it('CLAUDE.md, settings.json, commands/, skills/ are synced', () => {
    expect(isClaudePathSynced('CLAUDE.md', ALL_ON_PRE)).toBe(true)
    expect(isClaudePathSynced('settings.json', ALL_ON_PRE)).toBe(true)
    expect(isClaudePathSynced('commands/a.md', ALL_ON_PRE)).toBe(true)
    expect(isClaudePathSynced('skills/foo/SKILL.md', ALL_ON_PRE)).toBe(true)
  })
  // ... (rest unchanged, no syncGlobal needed for ignored paths)
  it('projects/<hash>/memory/ is synced, projects/<hash>/sessions/ is ignored', () => {
    expect(isClaudePathSynced('projects/abc123/memory/note.md', ALL_ON_PRE)).toBe(true)
    expect(isClaudePathIgnored('projects/abc123/sessions/s.jsonl')).toBe(true)
    expect(isClaudePathIgnored('projects/abc123/x.jsonl')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx vitest run tests/main/engine/rules.test.ts`
Expected: TS errors — `isClaudePathSynced` signature mismatch; `isProjectDotClaudePathSynced` not exported.

- [ ] **Step 3: Implement gating + project rules in `rules.ts`**

Replace `isClaudePathSynced` (line 79–90) and add new helper. Note: `ClaudeGlobalSyncFlags` lives in `@shared/api` (added in Task 1) — import it, do NOT redeclare. Final state of `rules.ts` (relevant portion):

```ts
import type { ClaudeGlobalSyncFlags } from '@shared/api'

export function isClaudePathSynced(
  relPath: string,
  syncGlobal: ClaudeGlobalSyncFlags,
): boolean {
  if (isClaudePathIgnored(relPath)) return false
  const norm = relPath.replace(/\\/g, '/')
  const top = topSegment(norm)
  if (!CLAUDE_TOP_LEVEL_SYNC.has(top)) return false
  if (top === 'projects') {
    const parts = norm.split('/')
    return parts[2] === 'memory'
  }
  if (top === 'CLAUDE.md') return syncGlobal.claudeMd
  if (top === 'commands') return syncGlobal.commands
  if (top === 'skills') return syncGlobal.skills
  if (top === 'settings.json') return syncGlobal.settings
  return true
}

/** Hardcoded ignore prefixes/exact names within <project>/.claude/. */
const PROJECT_DOTCLAUDE_IGNORE_TOP = new Set([
  ...CLAUDE_IGNORE_TOP,
  'worktrees',
  'scheduled_tasks.lock',
])

/** Top-level entries within <project>/.claude/ that are synced. */
const PROJECT_DOTCLAUDE_SYNC = new Set([
  'CLAUDE.md',
  'settings.json',
  'commands',
  'skills',
])

export function isProjectDotClaudePathSynced(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  if (IGNORE_NAME.test(basename(norm))) return false
  const top = topSegment(norm)
  if (PROJECT_DOTCLAUDE_IGNORE_TOP.has(top)) return false
  if (!PROJECT_DOTCLAUDE_SYNC.has(top)) return false
  return true
}
```

Note: `CLAUDE_IGNORE_TOP` (line 13–22) is referenced by the new set spread. Make sure it remains accessible (currently `const CLAUDE_IGNORE_TOP = new Set(...)` — leave it as-is; the new set spreads its members).

Confirm `SETTINGS_KEY_ALLOW_LIST` remains exported as before — Task 4 imports it indirectly via `enumClaudeProjectDotClaudeSource`.

- [ ] **Step 4: Run tests, expect green**

Run: `npx vitest run tests/main/engine/rules.test.ts`
Expected: PASS for both old (updated to pass ALL_ON_PRE) and new describe blocks.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine/rules.test.ts`
Expected: typecheck shows errors from callers of `isClaudePathSynced` (source-enum.ts) that don't pass `syncGlobal` yet — that's fine, fixed in Task 4. For this task, the rules tests pass.

---

## Task 3: Expand `SourceRef` and `FileEntry`

**Files:**
- Modify: `src/shared/sync-types.ts:1-23`

- [ ] **Step 1: Update `SourceRef` discriminated union**

Replace lines 1–23 of `src/shared/sync-types.ts`:

```ts
// src/shared/sync-types.ts

/** What kind of source surface this entry belongs to. */
export type SourceKind =
  | 'claude-global'
  | 'claude-project-memory'
  | 'claude-project-dotclaude'
  | 'cursor-project'

/** Reference to a surface — either Claude global, Claude per-project memory,
 *  Claude per-project .claude/, or a named Cursor project. */
export type SourceRef =
  | { kind: 'claude-global' }
  | { kind: 'claude-project-memory'; projectName: string }
  | { kind: 'claude-project-dotclaude'; projectName: string }
  | { kind: 'cursor-project'; projectName: string }

/** A single file in source or HEAD. */
export type FileEntry = {
  /** Path within the repo, e.g. 'claude/CLAUDE.md' or 'cursor/projects/Foo/.cursorrules'. */
  repoPath: string
  /** Path within the source surface, e.g. 'CLAUDE.md' or '.cursorrules'. */
  surfacePath: string
  /** SHA-1 of canonical content. */
  sha1: string
  /** Posix file mode. */
  mode: '100644' | '100755'
  /** Byte size of canonical content. */
  size: number
}
```

- [ ] **Step 2: Find every consumer of `kind: 'claude'`**

Run: `npx grep -rn "kind: 'claude'" src tests` (or your Grep tool of choice).

Expected hits: roughly `engine.ts` (multiple), `source-enum.ts`, `comparator.ts`, `pull-apply.ts` indirectly via engine. Tasks 4–7 update them. For this task, expect `tsc --noEmit` to report errors at each call site.

- [ ] **Step 3: Verify (intentionally fails typecheck — proceed)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: many TS errors at call sites of the old `'claude'` kind. This is intended; subsequent tasks resolve them. Do NOT proceed to Task 4 if errors are NOT present (means the change didn't land).

---

## Task 4: `source-enum.ts` — gating + new dotClaude enum

**Files:**
- Modify: `src/main/sync/engine/source-enum.ts:1-119`
- Modify: `tests/main/engine/source-enum.test.ts:5-83` (existing) + new tests for gating and dotClaude

- [ ] **Step 1: Write failing tests for global gating**

Append to `tests/main/engine/source-enum.test.ts`:

```ts
import { enumClaudeProjectDotClaudeSource } from '../../../src/main/sync/engine/source-enum'

const ALL_ON = { claudeMd: true, commands: true, skills: true, settings: true }

describe('enumClaudeSource — syncGlobal gating', () => {
  it('claudeMd=false skips CLAUDE.md', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claude, 'settings.json'), '{"permissions":{"allow":["x"]}}')
    const out = await enumClaudeSource(claude, [], { ...ALL_ON, claudeMd: false })
    expect(out.map(e => e.repoPath)).toEqual(['claude/settings.json'])
  })
  it('commands=false skips commands/*', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'commands'), { recursive: true })
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'commands', 'a.md'), 'A')
    const out = await enumClaudeSource(claude, [], { ...ALL_ON, commands: false })
    expect(out.map(e => e.repoPath)).toEqual(['claude/CLAUDE.md'])
  })
  it('settings=false skips settings.json (does not canonicalize)', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'settings.json'), '{"permissions":{"allow":["x"]}}')
    const out = await enumClaudeSource(claude, [], { ...ALL_ON, settings: false })
    expect(out.map(e => e.repoPath)).toEqual(['claude/CLAUDE.md'])
  })
  it('all false skips everything top-level but keeps memory', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    const off = { claudeMd: false, commands: false, skills: false, settings: false }
    const out = await enumClaudeSource(claude, [{ name: 'p', path: 'abc', syncMemory: true, syncDotClaude: true }], off)
    expect(out.map(e => e.repoPath)).toEqual(['claude/projects/p/memory/n.md'])
  })
  it('per-project syncMemory=false skips memory for that project', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    const out = await enumClaudeSource(claude,
      [{ name: 'p', path: 'abc', syncMemory: false, syncDotClaude: true }], ALL_ON)
    expect(out).toEqual([])
  })
})

describe('enumClaudeProjectDotClaudeSource', () => {
  it('returns CLAUDE.md, settings.json (canonicalized), commands/, skills/', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.claude', 'commands'), { recursive: true })
    mkdirSync(join(proj, '.claude', 'skills', 's'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(proj, '.claude', 'settings.json'),
      '{"permissions":{"allow":["x"]},"numStartups":1}')
    writeFileSync(join(proj, '.claude', 'commands', 'a.md'), 'A')
    writeFileSync(join(proj, '.claude', 'skills', 's', 'SKILL.md'), 'S')
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    const paths = out.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'claude/projects/MyProj/.claude/CLAUDE.md',
      'claude/projects/MyProj/.claude/commands/a.md',
      'claude/projects/MyProj/.claude/settings.json',
      'claude/projects/MyProj/.claude/skills/s/SKILL.md',
    ])
    // settings.json should be canonicalized (no numStartups)
    const settings = out.find(e => e.repoPath === 'claude/projects/MyProj/.claude/settings.json')!
    expect(settings.size).toBe(
      Buffer.from('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}', 'utf8').length,
    )
  })
  it('ignores settings.local.json, worktrees/, scheduled_tasks.lock, .credentials.json', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.claude', 'worktrees', 'wt'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'settings.local.json'), '{}')
    writeFileSync(join(proj, '.claude', 'scheduled_tasks.lock'), 'lock')
    writeFileSync(join(proj, '.claude', '.credentials.json'), 'C')
    writeFileSync(join(proj, '.claude', 'worktrees', 'wt', 'x'), 'X')
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    expect(out).toEqual([])
  })
  it('returns [] when <project>/.claude/ does not exist', async () => {
    const proj = join(dir, 'no-dot-claude')
    mkdirSync(proj)
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    expect(out).toEqual([])
  })
})
```

Also update the EXISTING `enumClaudeSource` tests in this file to pass `ALL_ON` as the third argument. For each existing `await enumClaudeSource(claude)` or `await enumClaudeSource(claude, [...])`, append `, ALL_ON`. Examples:

```ts
// line ~21: was
const out = await enumClaudeSource(claude)
// becomes
const out = await enumClaudeSource(claude, [], ALL_ON)

// line ~57: was
const out = await enumClaudeSource(claude, [{ name: 'myproj', path: 'abc' }])
// becomes
const out = await enumClaudeSource(claude,
  [{ name: 'myproj', path: 'abc', syncMemory: true, syncDotClaude: true }], ALL_ON)
```

Apply to all 5 existing `enumClaudeSource` calls in the file.

- [ ] **Step 2: Run tests, expect failure**

Run: `npx vitest run tests/main/engine/source-enum.test.ts`
Expected: TS errors / missing-export errors (`enumClaudeProjectDotClaudeSource` not exported, `enumClaudeSource` signature mismatch).

- [ ] **Step 3: Update `source-enum.ts`**

Replace the imports and `enumClaudeSource` (full new content for the relevant region):

```ts
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { createHash } from 'node:crypto'
import type { FileEntry } from '@shared/sync-types'
import type { ClaudeProject, ClaudeGlobalSyncFlags } from '@shared/api'
import {
  isClaudePathSynced,
  isClaudePathIgnored,
  isCursorPathSynced,
  isProjectDotClaudePathSynced,
  encodeClaudeProjectSegment,
} from './rules'
import { canonicalizeSettings } from './settings-canonical'

/** Build encoded→ClaudeProject lookup for fast translation while walking. */
function projectIndex(projects: ClaudeProject[]): Map<string, ClaudeProject> {
  const m = new Map<string, ClaudeProject>()
  for (const p of projects) m.set(encodeClaudeProjectSegment(p.path), p)
  return m
}

const MAX_BYTES = 5 * 1024 * 1024 // 5MB

function sha1OfBlob(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(content).digest('hex')
}

function walk(rootAbs: string, prefixParts: string[], cb: (relPosix: string, abs: string) => void): void {
  if (!existsSync(rootAbs)) return
  let entries: string[]
  try { entries = readdirSync(rootAbs) } catch { return }
  for (const name of entries) {
    const abs = join(rootAbs, name)
    let lst
    try { lst = lstatSync(abs) } catch { continue }
    if (lst.isSymbolicLink() && !existsSync(abs)) continue
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) {
      walk(abs, [...prefixParts, name], cb)
    } else if (st.isFile()) {
      const rel = posix.join(...prefixParts, name)
      cb(rel, abs)
    }
  }
}

/** Walks ~/.claude, returns synced file entries gated by syncGlobal. Per-project
 *  memory walks are gated by each project's `syncMemory` flag. */
export async function enumClaudeSource(
  claudePath: string,
  claudeProjects: ClaudeProject[] = [],
  syncGlobal: ClaudeGlobalSyncFlags = { claudeMd: true, commands: true, skills: true, settings: true },
): Promise<FileEntry[]> {
  if (!existsSync(claudePath)) return []
  const idx = projectIndex(claudeProjects)
  const out: FileEntry[] = []
  walk(claudePath, [], (rel, abs) => {
    if (isClaudePathIgnored(rel)) return
    if (!isClaudePathSynced(rel, syncGlobal)) return
    let st
    try { st = statSync(abs) } catch { return }
    if (st.size > MAX_BYTES) return
    let content: Buffer
    try { content = readFileSync(abs) } catch { return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { return }
    }
    // Translate projects/<encoded>/memory/... → projects/<name>/memory/...
    let repoRel = rel
    const m = rel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
    if (m) {
      const encoded = m[1]!
      const tail = m[2]!
      const proj = idx.get(encoded)
      if (!proj) return // unregistered project — skip
      if (!proj.syncMemory) return // per-project memory toggle off — skip
      repoRel = `projects/${proj.name}/${tail}`
    }
    const sha1 = sha1OfBlob(content)
    out.push({
      repoPath: `claude/${repoRel}`,
      surfacePath: rel,
      sha1,
      mode: '100644',
      size: content.length,
    })
  })
  return out
}

/** Walks <project>/.claude/, returns synced file entries. Used when
 *  project.syncDotClaude=true. Settings.json is canonicalized identically to
 *  the global one (same SETTINGS_KEY_ALLOW_LIST). */
export async function enumClaudeProjectDotClaudeSource(
  projectPath: string,
  projectName: string,
): Promise<FileEntry[]> {
  const root = join(projectPath, '.claude')
  if (!existsSync(root)) return []
  const out: FileEntry[] = []
  walk(root, [], (rel, abs) => {
    if (!isProjectDotClaudePathSynced(rel)) return
    let st
    try { st = statSync(abs) } catch { return }
    if (st.size > MAX_BYTES) return
    let content: Buffer
    try { content = readFileSync(abs) } catch { return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { return }
    }
    const sha1 = sha1OfBlob(content)
    out.push({
      repoPath: `claude/projects/${projectName}/.claude/${rel}`,
      surfacePath: `.claude/${rel}`,
      sha1,
      mode: '100644',
      size: content.length,
    })
  })
  return out
}

/** Walks a Cursor project root, returns synced .cursor/* + .cursorrules entries. */
export async function enumCursorProjectSource(projectPath: string, projectName: string): Promise<FileEntry[]> {
  if (!existsSync(projectPath)) return []
  const out: FileEntry[] = []
  walk(projectPath, [], (rel, abs) => {
    if (!isCursorPathSynced(rel)) return
    let st
    try { st = statSync(abs) } catch { return }
    if (st.size > MAX_BYTES) return
    let content: Buffer
    try { content = readFileSync(abs) } catch { return }
    const sha1 = sha1OfBlob(content)
    out.push({
      repoPath: `cursor/projects/${projectName}/${rel}`,
      surfacePath: rel,
      sha1,
      mode: '100644',
      size: content.length,
    })
  })
  return out
}

/** Helper used by IndexBuilder: read raw bytes of a source file (with canonicalization for settings.json). */
export function readSourceForCommit(surfaceAbsPath: string, surfaceRelPath: string): Buffer {
  const raw = readFileSync(surfaceAbsPath)
  // Both global ~/.claude/settings.json and project .claude/settings.json go through canonicalization.
  if (surfaceRelPath === 'settings.json' || surfaceRelPath === '.claude/settings.json') {
    return canonicalizeSettings(raw)
  }
  return raw
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `npx vitest run tests/main/engine/source-enum.test.ts`
Expected: PASS for new and existing (now passing `ALL_ON`) tests.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine/source-enum.test.ts`
Expected: tests pass. Typecheck will still complain at `engine.ts` (next task).

---

## Task 5: `engine.ts` — refresh + new kinds + path resolution

**Files:**
- Modify: `src/main/sync/engine/engine.ts:1-349`
- Modify: `tests/main/engine/engine-refresh.test.ts` (existing assertions of `kind: 'claude'` → `'claude-global'`)

- [ ] **Step 1: Update path-translation helper for `.claude` entries**

Replace `claudeRepoRelToSurfaceRel` (lines 30–41) with a function that handles both memory and `.claude/`:

```ts
/**
 * Translate a repo-side `claude/...` path into the local on-disk relative path
 * under `~/.claude` or `<project>` root.
 *
 * Returns null when the project name is present in the repo but not registered
 * on this device (caller treats as skip).
 *
 * Output shape:
 *   - global top-level (CLAUDE.md, commands/, skills/, settings.json)
 *     → returns the same string, e.g. 'CLAUDE.md' (relative to ~/.claude).
 *   - projects/<name>/memory/<tail>
 *     → 'projects/<encoded>/memory/<tail>' (relative to ~/.claude).
 *   - projects/<name>/.claude/<tail>
 *     → '.claude/<tail>' (relative to the registered project's path).
 *     Caller must know to join against project.path, not claudePath.
 */
function claudeRepoRelToSurfaceRel(
  repoRel: string,
  claudeProjects: ClaudeProject[],
): string | null {
  const mDot = repoRel.match(/^projects\/([^/]+)\/\.claude\/(.*)$/)
  if (mDot) {
    const name = mDot[1]!
    const tail = mDot[2]!
    const proj = claudeProjects.find((p) => p.name === name)
    if (!proj) return null
    return `.claude/${tail}`
  }
  const mMem = repoRel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
  if (mMem) {
    const name = mMem[1]!
    const tail = mMem[2]!
    const proj = claudeProjects.find((p) => p.name === name)
    if (!proj) return null
    return `projects/${encodeClaudeProjectSegment(proj.path)}/${tail}`
  }
  return repoRel
}
```

- [ ] **Step 2: Update `refreshStatus` to enumerate project dotClaude surface**

Replace the Claude section of `refreshStatus` (lines 53–67) with:

```ts
// Claude global + per-project memory (one combined surface)
if (claudePath) {
  const src: SourceRef = { kind: 'claude-global' }
  const srcEntries = await enumClaudeSource(claudePath, args.claudeProjects, /* syncGlobal */
    // syncGlobal comes from cfg.claude.syncGlobal — added to RefreshArgs below.
    args.syncGlobal,
  )
  const headEntries = await enumHead(repoPath, 'claude/', 'claude/')
  // Filter HEAD entries belonging to claude/projects/<name>/* where <name> is
  // not registered locally OR where the relevant per-project toggle is off
  // — otherwise compare() would see them as "deleted-on-source" and try to
  // wipe data the user never opted in to.
  const filteredHead = headEntries.filter((h) => {
    const rel = h.repoPath.startsWith('claude/') ? h.repoPath.slice('claude/'.length) : h.repoPath
    // Global top-level: filter by syncGlobal flag
    if (!rel.startsWith('projects/')) {
      if (rel === 'CLAUDE.md') return args.syncGlobal.claudeMd
      if (rel === 'settings.json') return args.syncGlobal.settings
      if (rel.startsWith('commands/')) return args.syncGlobal.commands
      if (rel.startsWith('skills/')) return args.syncGlobal.skills
      return true
    }
    // Per-project memory: check syncMemory; per-project .claude: check syncDotClaude.
    const mDot = rel.match(/^projects\/([^/]+)\/\.claude\//)
    if (mDot) {
      const proj = args.claudeProjects.find((p) => p.name === mDot[1])
      return !!proj && proj.syncDotClaude
    }
    const mMem = rel.match(/^projects\/([^/]+)\/memory\//)
    if (mMem) {
      const proj = args.claudeProjects.find((p) => p.name === mMem[1])
      return !!proj && proj.syncMemory
    }
    return claudeRepoRelToSurfaceRel(rel, args.claudeProjects) !== null
  })
  const part = compare(src, srcEntries, filteredHead.map((h) => ({ ...h, sha: h.sha1 })), args.claudeProjects)
  diffs.push(...part)
}

// Per-project .claude/ surfaces (one SourceRef per project with syncDotClaude=true)
for (const proj of args.claudeProjects) {
  if (!proj.syncDotClaude) continue
  const src: SourceRef = { kind: 'claude-project-dotclaude', projectName: proj.name }
  const srcEntries = await enumClaudeProjectDotClaudeSource(proj.path, proj.name)
  // HEAD entries for this project's dotClaude live under claude/projects/<name>/.claude/
  // but they were ALREADY accounted for in the combined Claude diff above (filteredHead
  // includes them). The comparator above will diff srcEntries vs headEntries for the
  // combined claude/ prefix, so we DO NOT push a second diff here — instead, we feed
  // srcEntries into the combined comparison by concatenating before compare.
  //
  // SIMPLER APPROACH: collect all srcEntries (global + memory + dotClaude per project)
  // into ONE list before calling compare. The compare() result then naturally classifies
  // each entry by repoPath prefix. Each diff entry inherits SourceRef from the source
  // it came from.
  //
  // To do this cleanly, restructure: build srcEntries once with the right SourceRef
  // attached per entry (instead of one ref per compare call).
  //
  // See Step 3 below — this loop is replaced.
  void src; void srcEntries
}
```

Wait — the inline note above flags that the simple loop-then-compare structure doesn't work cleanly because `compare()` takes one `SourceRef` for the whole batch. Replace Steps 2 + 3 of this task with a cleaner restructure (Step 3 below).

- [ ] **Step 3: Restructure the Claude diff collection**

Replace the entire Claude section of `refreshStatus` (the block from line 53 through line 67 in the original) with the following. `RefreshArgs` also needs `syncGlobal`:

```ts
// Top of file — extend RefreshArgs:
export type RefreshArgs = {
  repoPath: string | null
  claudePath: string | null
  claudeProjects: ClaudeProject[]
  cursorProjects: CursorProject[]
  token: string | null
  doFetch?: boolean
  /** Global category toggles for ~/.claude top-level entries. */
  syncGlobal: ClaudeConfig['syncGlobal']
}

// Imports — add:
import type { ClaudeConfig } from '@shared/api'
import { enumClaudeProjectDotClaudeSource } from './source-enum'

// Inside refreshStatus, replace the Claude block:
if (claudePath) {
  // Collect source entries from all enabled Claude surfaces, with explicit SourceRef per entry.
  type Entry = { ref: SourceRef; file: import('@shared/sync-types').FileEntry }
  const allSrc: Entry[] = []
  // Global + per-project memory
  const globalEntries = await enumClaudeSource(claudePath, args.claudeProjects, args.syncGlobal)
  for (const f of globalEntries) {
    // Distinguish memory entries from global top-level by repoPath shape.
    const m = f.repoPath.match(/^claude\/projects\/([^/]+)\/memory\//)
    if (m) {
      allSrc.push({ ref: { kind: 'claude-project-memory', projectName: m[1]! }, file: f })
    } else {
      allSrc.push({ ref: { kind: 'claude-global' }, file: f })
    }
  }
  // Per-project .claude/
  for (const proj of args.claudeProjects) {
    if (!proj.syncDotClaude) continue
    const dotEntries = await enumClaudeProjectDotClaudeSource(proj.path, proj.name)
    for (const f of dotEntries) {
      allSrc.push({ ref: { kind: 'claude-project-dotclaude', projectName: proj.name }, file: f })
    }
  }

  // HEAD entries with filtering by toggles.
  const headEntries = await enumHead(repoPath, 'claude/', 'claude/')
  const filteredHead = headEntries.filter((h) => {
    const rel = h.repoPath.startsWith('claude/') ? h.repoPath.slice('claude/'.length) : h.repoPath
    if (!rel.startsWith('projects/')) {
      if (rel === 'CLAUDE.md') return args.syncGlobal.claudeMd
      if (rel === 'settings.json') return args.syncGlobal.settings
      if (rel.startsWith('commands/')) return args.syncGlobal.commands
      if (rel.startsWith('skills/')) return args.syncGlobal.skills
      return true
    }
    const mDot = rel.match(/^projects\/([^/]+)\/\.claude\//)
    if (mDot) {
      const proj = args.claudeProjects.find((p) => p.name === mDot[1])
      return !!proj && proj.syncDotClaude
    }
    const mMem = rel.match(/^projects\/([^/]+)\/memory\//)
    if (mMem) {
      const proj = args.claudeProjects.find((p) => p.name === mMem[1])
      return !!proj && proj.syncMemory
    }
    return false
  })

  // Diff: comparator needs (source, srcEntries, headEntries, ...). We split allSrc by ref
  // to call compare() once per ref-kind, because compare attaches the same SourceRef to
  // every result. This mirrors how cursor projects are handled.
  const byRefKey = new Map<string, { ref: SourceRef; files: typeof allSrc[number]['file'][] }>()
  for (const e of allSrc) {
    const key = e.ref.kind === 'claude-global'
      ? 'claude-global'
      : `${e.ref.kind}::${(e.ref as { projectName: string }).projectName}`
    let bucket = byRefKey.get(key)
    if (!bucket) {
      bucket = { ref: e.ref, files: [] }
      byRefKey.set(key, bucket)
    }
    bucket.files.push(e.file)
  }
  // HEAD likewise split by ref-prefix
  function refForRepoPath(p: string): SourceRef | null {
    const rel = p.startsWith('claude/') ? p.slice('claude/'.length) : p
    if (!rel.startsWith('projects/')) return { kind: 'claude-global' }
    const mDot = rel.match(/^projects\/([^/]+)\/\.claude\//)
    if (mDot) return { kind: 'claude-project-dotclaude', projectName: mDot[1]! }
    const mMem = rel.match(/^projects\/([^/]+)\/memory\//)
    if (mMem) return { kind: 'claude-project-memory', projectName: mMem[1]! }
    return null
  }
  const headByKey = new Map<string, typeof filteredHead>()
  for (const h of filteredHead) {
    const ref = refForRepoPath(h.repoPath)
    if (!ref) continue
    const key = ref.kind === 'claude-global'
      ? 'claude-global'
      : `${ref.kind}::${(ref as { projectName: string }).projectName}`
    if (!byRefKey.has(key)) byRefKey.set(key, { ref, files: [] })
    if (!headByKey.has(key)) headByKey.set(key, [])
    headByKey.get(key)!.push(h)
  }
  for (const [key, bucket] of byRefKey) {
    const heads = headByKey.get(key) ?? []
    const part = compare(bucket.ref, bucket.files,
      heads.map((h) => ({ ...h, sha: h.sha1 })), args.claudeProjects)
    diffs.push(...part)
  }
}
```

- [ ] **Step 4: Update `surfaceAbsPath` to handle new kinds**

Replace `surfaceAbsPath` (lines 142–151) with:

```ts
function surfaceAbsPath(args: RefreshArgs, d: DiffEntry): string | null {
  if (d.source.kind === 'claude-global') {
    if (!args.claudePath) return null
    return join(args.claudePath, d.surfacePath)
  }
  if (d.source.kind === 'claude-project-memory') {
    if (!args.claudePath) return null
    return join(args.claudePath, d.surfacePath)
  }
  if (d.source.kind === 'claude-project-dotclaude') {
    const proj = args.claudeProjects.find((p) => p.name === d.source.projectName)
    if (!proj) return null
    // d.surfacePath already starts with '.claude/' (set in enumClaudeProjectDotClaudeSource)
    return join(proj.path, d.surfacePath)
  }
  // cursor-project
  const projectName = d.source.projectName
  const proj = args.cursorProjects.find((p) => p.name === projectName)
  if (!proj) return null
  return join(proj.path, d.surfacePath)
}
```

- [ ] **Step 5: Update `computePullPreview` source classification**

In `computePullPreview` (lines 199–289), replace the `source` derivation block (lines 243–256):

```ts
let surfacePath: string
let source: SourceRef
if (path.startsWith('claude/')) {
  const repoRel = path.slice('claude/'.length)
  if (!repoRel.startsWith('projects/')) {
    source = { kind: 'claude-global' }
    // Honour syncGlobal — skip entries from disabled global categories.
    if (repoRel === 'CLAUDE.md' && !args.syncGlobal.claudeMd) continue
    if (repoRel === 'settings.json' && !args.syncGlobal.settings) continue
    if (repoRel.startsWith('commands/') && !args.syncGlobal.commands) continue
    if (repoRel.startsWith('skills/') && !args.syncGlobal.skills) continue
    surfacePath = repoRel
  } else {
    const mDot = repoRel.match(/^projects\/([^/]+)\/\.claude\/(.*)$/)
    const mMem = repoRel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
    if (mDot) {
      const proj = args.claudeProjects.find((p) => p.name === mDot[1])
      if (!proj || !proj.syncDotClaude) continue
      source = { kind: 'claude-project-dotclaude', projectName: mDot[1]! }
      surfacePath = `.claude/${mDot[2]!}`
    } else if (mMem) {
      const proj = args.claudeProjects.find((p) => p.name === mMem[1])
      if (!proj || !proj.syncMemory) continue
      source = { kind: 'claude-project-memory', projectName: mMem[1]! }
      surfacePath = `projects/${encodeClaudeProjectSegment(proj.path)}/${mMem[2]!}`
    } else {
      continue
    }
  }
} else {
  const m = path.match(/^cursor\/projects\/([^/]+)\/(.*)$/)
  if (!m) continue
  source = { kind: 'cursor-project', projectName: m[1]! }
  surfacePath = m[2]!
}
```

Inside the same loop, the existing `srcAbs` resolution (lines 272–277) uses `source.kind === 'claude'` — replace with new kinds:

```ts
let srcAbs: string | null
if (source.kind === 'claude-global' || source.kind === 'claude-project-memory') {
  srcAbs = args.claudePath ? join(args.claudePath, surfacePath) : null
} else if (source.kind === 'claude-project-dotclaude') {
  const proj = args.claudeProjects.find((p) => p.name === source.projectName)
  srcAbs = proj ? join(proj.path, surfacePath) : null
} else {
  const proj = args.cursorProjects.find((p) => p.name === source.projectName)
  srcAbs = proj ? join(proj.path, surfacePath) : null
}
if (!srcAbs) continue
```

- [ ] **Step 6: Update `executePullApply` settings-merge to handle project .claude**

In `executePullApply` (lines 293–325), update the `mergeSettingsForPull` branch (lines 313–318):

```ts
let toWrite = item.newContent
const isGlobalSettings =
  item.source.kind === 'claude-global' && item.surfacePath === 'settings.json'
const isProjectSettings =
  item.source.kind === 'claude-project-dotclaude' && item.surfacePath === '.claude/settings.json'
if (isGlobalSettings || isProjectSettings) {
  const currentSrc = readSourceIfExists(surfaceAbs)
  toWrite = mergeSettingsForPull(item.newContent, currentSrc)
}
await applyToSource(surfaceAbs, toWrite)
```

- [ ] **Step 7: Update `executeDiscard` prefix computation**

`executeDiscard` (lines 327–349) builds a prefix per source. Replace:

```ts
const prefix = d.source.kind === 'claude' ? 'claude/' : `cursor/projects/${d.source.projectName}/`
```

with:

```ts
let prefix: string
if (d.source.kind === 'claude-global') prefix = 'claude/'
else if (d.source.kind === 'claude-project-memory') prefix = `claude/projects/${d.source.projectName}/memory/`
else if (d.source.kind === 'claude-project-dotclaude') prefix = `claude/projects/${d.source.projectName}/.claude/`
else prefix = `cursor/projects/${d.source.projectName}/`
```

- [ ] **Step 8: Update call sites of `refreshStatus` to pass `syncGlobal`**

Every caller in `src/main/ipc.ts` and `src/main/sync-status.ts` constructs `RefreshArgs`. Search and add `syncGlobal: cfg.claude.syncGlobal`. Run:

`npx grep -rn "claudeProjects:" src/main` → audit each call to `refreshStatus`, `computePushPreview`, `executePush`, `computePullPreview`, `executePullApply`, `executeDiscard`. Add `syncGlobal: cfg.claude.syncGlobal` to each `RefreshArgs` literal.

If `cfg.claude.syncGlobal` is undefined (older config that bypassed migration), substitute `{ claudeMd: true, commands: true, skills: true, settings: true }`. The migration in Task 1 prevents this for properly-loaded configs.

- [ ] **Step 9: Update tests in `engine-refresh.test.ts` etc.**

Update existing engine tests that construct `RefreshArgs`. Read `tests/main/engine/engine-refresh.test.ts`, `tests/main/engine/engine-push.test.ts`, `tests/main/engine/engine-pull.test.ts`, `tests/main/engine/engine-discard.test.ts`, `tests/main/engine/regression-no-phantom-after-pull.test.ts`. For each `RefreshArgs` or `PushArgs` literal, add:

```ts
syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
```

For each `ClaudeProject` literal (`{ name: 'x', path: '/...' }`), expand to:

```ts
{ name: 'x', path: '/...', syncMemory: true, syncDotClaude: true }
```

Also update any expectations of `kind: 'claude'` to `kind: 'claude-global'` (or `claude-project-memory` if the test path is under `projects/<name>/memory/`).

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine`
Expected: typecheck clean; all engine tests pass.

---

## Task 6: Round-trip fixture and invariant test suite

**Files:**
- Create: `tests/fixtures/sync-roundtrip.ts`
- Create: `tests/main/engine/sync-roundtrip.test.ts`

- [ ] **Step 1: Create fixture builder + helper**

Create `tests/fixtures/sync-roundtrip.ts`:

```ts
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { ClaudeConfig, ClaudeProject } from '@shared/api'
import {
  enumClaudeSource,
  enumClaudeProjectDotClaudeSource,
} from '../../src/main/sync/engine/source-enum'
import { encodeClaudeProjectSegment } from '../../src/main/sync/engine/rules'
import { buildAndCommitFromSource } from '../../src/main/sync/engine/index-builder'
import { catFileBlob } from '../../src/main/sync/engine/git-ops'
import { mergeSettingsForPull, applyToSource } from '../../src/main/sync/engine/pull-apply'

/** A tree of files: path (posix-relative) → sha256 of bytes. */
export type Tree = Map<string, string>

export function sha256File(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

export function snapshotTree(rootAbs: string): Tree {
  const tree: Tree = new Map()
  if (!existsSync(rootAbs)) return tree
  const stack: string[] = [rootAbs]
  while (stack.length) {
    const cur = stack.pop()!
    for (const name of readdirSync(cur)) {
      const abs = join(cur, name)
      const st = statSync(abs)
      if (st.isDirectory()) stack.push(abs)
      else if (st.isFile()) {
        const rel = relative(rootAbs, abs).split(sep).join(posix.sep)
        tree.set(rel, sha256File(abs))
      }
    }
  }
  return tree
}

export type FixtureProject = {
  name: string
  /** Absolute path to the project root that will be created. */
  path: string
  /** Encoded segment under ~/.claude/projects/. Computed from `path`. */
  encoded: string
}

export type FixtureLayout = {
  /** Root dir containing everything. */
  root: string
  /** ~/.claude */
  home: string
  /** Per-project info. */
  projects: FixtureProject[]
}

/** Build a realistic source fixture under `root`:
 *  - root/home/.claude/ with mixed synced + service files
 *  - root/projects/<name>/ with .claude/ subdir containing mixed files
 */
export function buildSourceFixture(root: string, projectNames: string[]): FixtureLayout {
  mkdirSync(root, { recursive: true })
  const home = join(root, 'home', '.claude')
  mkdirSync(home, { recursive: true })
  // Global synced
  writeFileSync(join(home, 'CLAUDE.md'), 'global rules\n')
  writeFileSync(
    join(home, 'settings.json'),
    JSON.stringify(
      {
        permissions: { allow: ['Bash(ls)'] },
        userID: 'SECRET-userid-should-not-sync',
        cachedFoo: 42,
        theme: 'dark',
      },
      null,
      2,
    ),
  )
  mkdirSync(join(home, 'commands'), { recursive: true })
  writeFileSync(join(home, 'commands', 'cmd.md'), 'global cmd\n')
  mkdirSync(join(home, 'skills', 'sk1'), { recursive: true })
  writeFileSync(join(home, 'skills', 'sk1', 'SKILL.md'), 'global skill\n')
  // Global service files (must never sync)
  mkdirSync(join(home, 'plugins'), { recursive: true })
  mkdirSync(join(home, 'sessions'), { recursive: true })
  mkdirSync(join(home, 'cache'), { recursive: true })
  mkdirSync(join(home, 'ide'), { recursive: true })
  mkdirSync(join(home, 'statsig'), { recursive: true })
  writeFileSync(join(home, 'plugins', 'p.json'), 'P')
  writeFileSync(join(home, 'sessions', 's.jsonl'), 'S')
  writeFileSync(join(home, 'cache', 'c'), 'C')
  writeFileSync(join(home, 'ide', 'i'), 'I')
  writeFileSync(join(home, 'statsig', 'x'), 'X')
  writeFileSync(join(home, 'history.jsonl'), 'H')
  writeFileSync(join(home, '.credentials.json'), 'CREDS')
  writeFileSync(join(home, 'settings.local.json'), '{"local": true}')
  writeFileSync(join(home, 'CLAUDE.md.backup.20260101-120000'), 'backup')

  const projects: FixtureProject[] = []
  for (const name of projectNames) {
    const projPath = join(root, 'projects', name)
    mkdirSync(projPath, { recursive: true })
    // <project>/.claude/ synced
    const dot = join(projPath, '.claude')
    mkdirSync(dot, { recursive: true })
    writeFileSync(join(dot, 'CLAUDE.md'), `proj ${name} rules\n`)
    writeFileSync(
      join(dot, 'settings.json'),
      JSON.stringify(
        {
          permissions: { allow: [`Bash(echo ${name})`] },
          userID: `secret-${name}`,
          theme: 'light',
        },
        null,
        2,
      ),
    )
    mkdirSync(join(dot, 'commands'), { recursive: true })
    writeFileSync(join(dot, 'commands', `${name}.md`), `cmd for ${name}\n`)
    mkdirSync(join(dot, 'skills', `s-${name}`), { recursive: true })
    writeFileSync(join(dot, 'skills', `s-${name}`, 'SKILL.md'), `skill for ${name}\n`)
    // <project>/.claude/ service files (must never sync)
    writeFileSync(join(dot, 'settings.local.json'), '{}')
    writeFileSync(join(dot, '.credentials.json'), 'PROJ-CREDS')
    writeFileSync(join(dot, 'scheduled_tasks.lock'), 'lock')
    mkdirSync(join(dot, 'worktrees', 'wt1'), { recursive: true })
    writeFileSync(join(dot, 'worktrees', 'wt1', 'x'), 'WT')
    // Memory under ~/.claude/projects/<encoded>/
    const encoded = encodeClaudeProjectSegment(projPath)
    mkdirSync(join(home, 'projects', encoded, 'memory'), { recursive: true })
    writeFileSync(join(home, 'projects', encoded, 'memory', `${name}.md`), `mem for ${name}\n`)
    mkdirSync(join(home, 'projects', encoded, 'sessions'), { recursive: true })
    writeFileSync(join(home, 'projects', encoded, 'sessions', 's.jsonl'), 'SESS')
    writeFileSync(join(home, 'projects', encoded, 'foo.jsonl'), 'FOO')

    projects.push({ name, path: projPath, encoded })
  }
  return { root, home, projects }
}

/** Initialise an empty git repo at `repoPath` with one empty commit on main. */
export function initEmptyRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true })
  const run = (args: string[]): void => {
    const r = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
  run(['init', '-b', 'main'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  run(['commit', '--allow-empty', '-m', 'init'])
}

/** Build claude project descriptors from a fixture, with toggle overrides. */
export function projectsFromFixture(
  layout: FixtureLayout,
  overrides: Partial<Record<string, Partial<Pick<ClaudeProject, 'syncMemory' | 'syncDotClaude'>>>> = {},
): ClaudeProject[] {
  return layout.projects.map((p) => ({
    name: p.name,
    path: p.path,
    syncMemory: overrides[p.name]?.syncMemory ?? true,
    syncDotClaude: overrides[p.name]?.syncDotClaude ?? true,
  }))
}

export type RoundTripConfig = {
  layout: FixtureLayout
  repoPath: string
  syncGlobal: ClaudeConfig['syncGlobal']
  projects: ClaudeProject[]
}

export type RoundTripResult = {
  /** Snapshot of source after fixture build (before any sync). */
  sourceHome: Tree
  sourceProjects: Map<string, Tree>
  /** Snapshot of repo's `claude/` after push. */
  repoClaude: Tree
  /** Snapshot of target after pulling everything from repo. */
  targetHome: Tree
  targetProjects: Map<string, Tree>
}

/** Push all enabled surfaces, then mirror back to a fresh target. */
export async function roundTrip(cfg: RoundTripConfig): Promise<RoundTripResult> {
  // 1. Snapshot source.
  const sourceHome = snapshotTree(cfg.layout.home)
  const sourceProjects = new Map<string, Tree>()
  for (const p of cfg.layout.projects) sourceProjects.set(p.name, snapshotTree(p.path))

  // 2. Enumerate and push (build index + commit on top of HEAD).
  const globalEntries = await enumClaudeSource(cfg.layout.home, cfg.projects, cfg.syncGlobal)
  const dotEntries = (await Promise.all(
    cfg.projects.filter((p) => p.syncDotClaude).map((p) => enumClaudeProjectDotClaudeSource(p.path, p.name)),
  )).flat()
  const allEntries = [...globalEntries, ...dotEntries]

  // 3. Build "diffs" from scratch — all "added" entries since repo starts empty (in claude/).
  const diffs = allEntries.map((e) => ({
    source: { kind: 'claude-global' as const }, // ref doesn't affect commit content
    repoPath: e.repoPath,
    surfacePath: e.surfacePath,
    status: 'added' as const,
    sourceSha: e.sha1,
  }))

  await buildAndCommitFromSource({
    repoPath: cfg.repoPath,
    diffs,
    sourceContent: (d) => {
      // d.surfacePath shape:
      //   global: 'CLAUDE.md', 'commands/...', 'skills/...', 'settings.json'
      //   memory: 'projects/<encoded>/memory/...'
      //   dotClaude: '.claude/...'
      if (d.surfacePath.startsWith('.claude/')) {
        // Resolve which project by matching repoPath -> projectName
        const m = d.repoPath.match(/^claude\/projects\/([^/]+)\/\.claude\//)
        if (!m) return null
        const proj = cfg.projects.find((p) => p.name === m[1])
        if (!proj) return null
        const abs = join(proj.path, d.surfacePath)
        // canonicalize settings.json
        if (d.surfacePath === '.claude/settings.json') {
          const { canonicalizeSettings } = require('../../src/main/sync/engine/settings-canonical') as
            typeof import('../../src/main/sync/engine/settings-canonical')
          return canonicalizeSettings(readFileSync(abs))
        }
        return readFileSync(abs)
      }
      // global / memory: live under cfg.layout.home
      const abs = join(cfg.layout.home, d.surfacePath)
      if (d.surfacePath === 'settings.json') {
        const { canonicalizeSettings } = require('../../src/main/sync/engine/settings-canonical') as
          typeof import('../../src/main/sync/engine/settings-canonical')
        return canonicalizeSettings(readFileSync(abs))
      }
      return readFileSync(abs)
    },
    commitMessage: 'round-trip push',
    indexFile: join(cfg.repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`),
  })

  const repoClaude = snapshotTree(join(cfg.repoPath, 'claude'))

  // 4. Create a clean target — separate dir mirroring layout (home + projects).
  const targetRoot = join(cfg.layout.root, 'target')
  const targetHome = join(targetRoot, 'home', '.claude')
  mkdirSync(targetHome, { recursive: true })
  const targetProjectsByName = new Map<string, string>()
  for (const p of cfg.layout.projects) {
    const tp = join(targetRoot, 'projects', p.name)
    mkdirSync(tp, { recursive: true })
    targetProjectsByName.set(p.name, tp)
  }

  // 5. Apply everything in `claude/` to target.
  for (const entry of allEntries) {
    // Read repo blob (we just committed it; HEAD has it).
    const blob = await catFileBlob(cfg.repoPath, entry.sha1)
    if (entry.surfacePath.startsWith('.claude/')) {
      const m = entry.repoPath.match(/^claude\/projects\/([^/]+)\/\.claude\//)
      if (!m) continue
      const tp = targetProjectsByName.get(m[1]!)
      if (!tp) continue
      // settings merge for project .claude/settings.json
      let toWrite = blob
      if (entry.surfacePath === '.claude/settings.json') {
        toWrite = mergeSettingsForPull(blob, null)
      }
      await applyToSource(join(tp, entry.surfacePath), toWrite)
    } else {
      // global or memory — both under home
      let toWrite = blob
      if (entry.surfacePath === 'settings.json') {
        toWrite = mergeSettingsForPull(blob, null)
      }
      await applyToSource(join(targetHome, entry.surfacePath), toWrite)
    }
  }

  // 6. Snapshot target.
  const tgtHome = snapshotTree(targetHome)
  const tgtProjects = new Map<string, Tree>()
  for (const p of cfg.layout.projects) {
    const tp = targetProjectsByName.get(p.name)!
    tgtProjects.set(p.name, snapshotTree(tp))
  }

  return {
    sourceHome,
    sourceProjects,
    repoClaude,
    targetHome,
    targetProjects: tgtProjects,
  }
}
```

- [ ] **Step 2: Write the parametrised test file**

Create `tests/main/engine/sync-roundtrip.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeConfig } from '@shared/api'
import {
  buildSourceFixture,
  initEmptyRepo,
  projectsFromFixture,
  roundTrip,
  type FixtureLayout,
} from '../../fixtures/sync-roundtrip'

const ALL_ON: ClaudeConfig['syncGlobal'] = {
  claudeMd: true,
  commands: true,
  skills: true,
  settings: true,
}

let root: string
let layout: FixtureLayout
let repoPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cs-rt-'))
  layout = buildSourceFixture(root, ['alpha', 'beta'])
  repoPath = join(root, 'repo')
  initEmptyRepo(repoPath)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('sync round-trip — full ON', () => {
  it('source ≡ target byte-for-byte for synced files; service files absent on target', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout),
    })

    // Global synced
    expect(r.targetHome.get('CLAUDE.md')).toBe(r.sourceHome.get('CLAUDE.md'))
    expect(r.targetHome.get('commands/cmd.md')).toBe(r.sourceHome.get('commands/cmd.md'))
    expect(r.targetHome.get('skills/sk1/SKILL.md')).toBe(r.sourceHome.get('skills/sk1/SKILL.md'))
    // settings.json is canonicalized (whitelist), so source != target byte-wise.
    // Instead: target settings.json must contain ONLY whitelist keys.
    // We check this in dedicated test below.

    // Memory synced
    for (const p of layout.projects) {
      const memRel = `projects/${p.encoded}/memory/${p.name}.md`
      expect(r.targetHome.get(memRel)).toBe(r.sourceHome.get(memRel))
    }

    // Per-project .claude synced (except settings.json canonicalization)
    for (const p of layout.projects) {
      const src = r.sourceProjects.get(p.name)!
      const tgt = r.targetProjects.get(p.name)!
      expect(tgt.get('.claude/CLAUDE.md')).toBe(src.get('.claude/CLAUDE.md'))
      expect(tgt.get(`.claude/commands/${p.name}.md`)).toBe(src.get(`.claude/commands/${p.name}.md`))
      expect(tgt.get(`.claude/skills/s-${p.name}/SKILL.md`))
        .toBe(src.get(`.claude/skills/s-${p.name}/SKILL.md`))
    }

    // Service files absent on target
    expect(r.targetHome.has('plugins/p.json')).toBe(false)
    expect(r.targetHome.has('sessions/s.jsonl')).toBe(false)
    expect(r.targetHome.has('cache/c')).toBe(false)
    expect(r.targetHome.has('ide/i')).toBe(false)
    expect(r.targetHome.has('statsig/x')).toBe(false)
    expect(r.targetHome.has('history.jsonl')).toBe(false)
    expect(r.targetHome.has('.credentials.json')).toBe(false)
    expect(r.targetHome.has('settings.local.json')).toBe(false)
    expect(r.targetHome.has('CLAUDE.md.backup.20260101-120000')).toBe(false)
    for (const p of layout.projects) {
      const tgt = r.targetProjects.get(p.name)!
      expect(tgt.has('.claude/settings.local.json')).toBe(false)
      expect(tgt.has('.claude/.credentials.json')).toBe(false)
      expect(tgt.has('.claude/scheduled_tasks.lock')).toBe(false)
      expect(tgt.has('.claude/worktrees/wt1/x')).toBe(false)
      // Per-project sessions (under home) also absent on target
      expect(r.targetHome.has(`projects/${p.encoded}/sessions/s.jsonl`)).toBe(false)
      expect(r.targetHome.has(`projects/${p.encoded}/foo.jsonl`)).toBe(false)
    }
  })

  it('global settings.json: target has only whitelisted keys', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout),
    })
    // Target file must parse and only contain whitelist keys.
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(join(root, 'target', 'home', '.claude', 'settings.json'), 'utf8')
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed.userID).toBeUndefined()
    expect(parsed.cachedFoo).toBeUndefined()
    expect(parsed.permissions).toEqual({ allow: ['Bash(ls)'] })
    expect(parsed.theme).toBe('dark')
  })

  it('project .claude/settings.json: target has only whitelisted keys', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout),
    })
    const { readFileSync } = await import('node:fs')
    for (const p of layout.projects) {
      const text = readFileSync(
        join(root, 'target', 'projects', p.name, '.claude', 'settings.json'),
        'utf8',
      )
      const parsed = JSON.parse(text) as Record<string, unknown>
      expect(parsed.userID).toBeUndefined()
      expect(parsed.permissions).toEqual({ allow: [`Bash(echo ${p.name})`] })
      expect(parsed.theme).toBe('light')
    }
    void r
  })
})

describe('sync round-trip — selective toggles', () => {
  it('syncGlobal.commands=false: global commands absent in repo and target', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, commands: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('commands/cmd.md')).toBe(false)
    expect(r.targetHome.has('commands/cmd.md')).toBe(false)
    // sibling categories still present
    expect(r.targetHome.has('CLAUDE.md')).toBe(true)
    expect(r.targetHome.has('skills/sk1/SKILL.md')).toBe(true)
    // project .claude unaffected
    expect(r.targetProjects.get('alpha')!.has('.claude/commands/alpha.md')).toBe(true)
  })

  it('syncGlobal.claudeMd=false', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, claudeMd: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('CLAUDE.md')).toBe(false)
    expect(r.targetHome.has('CLAUDE.md')).toBe(false)
    expect(r.targetHome.has('commands/cmd.md')).toBe(true)
  })

  it('syncGlobal.skills=false', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, skills: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('skills/sk1/SKILL.md')).toBe(false)
    expect(r.targetHome.has('skills/sk1/SKILL.md')).toBe(false)
  })

  it('syncGlobal.settings=false', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, settings: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('settings.json')).toBe(false)
    expect(r.targetHome.has('settings.json')).toBe(false)
  })

  it('project.syncMemory=false for alpha: alpha memory absent, beta memory present', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout, { alpha: { syncMemory: false } }),
    })
    const alpha = layout.projects.find((p) => p.name === 'alpha')!
    const beta = layout.projects.find((p) => p.name === 'beta')!
    expect(r.repoClaude.has(`projects/alpha/memory/alpha.md`)).toBe(false)
    expect(r.targetHome.has(`projects/${alpha.encoded}/memory/alpha.md`)).toBe(false)
    expect(r.targetHome.has(`projects/${beta.encoded}/memory/beta.md`)).toBe(true)
    // alpha .claude/ still synced
    expect(r.targetProjects.get('alpha')!.has('.claude/CLAUDE.md')).toBe(true)
  })

  it('project.syncDotClaude=false for alpha: alpha .claude absent, memory present', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout, { alpha: { syncDotClaude: false } }),
    })
    const alpha = layout.projects.find((p) => p.name === 'alpha')!
    expect(r.repoClaude.has('projects/alpha/.claude/CLAUDE.md')).toBe(false)
    expect(r.targetProjects.get('alpha')!.has('.claude/CLAUDE.md')).toBe(false)
    // alpha memory still present
    expect(r.targetHome.has(`projects/${alpha.encoded}/memory/alpha.md`)).toBe(true)
    // beta both still synced
    expect(r.targetProjects.get('beta')!.has('.claude/CLAUDE.md')).toBe(true)
  })

  it('both per-project flags false for alpha: alpha completely absent in repo', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout, {
        alpha: { syncMemory: false, syncDotClaude: false },
      }),
    })
    expect(r.repoClaude.has('projects/alpha/.claude/CLAUDE.md')).toBe(false)
    expect(r.repoClaude.has('projects/alpha/memory/alpha.md')).toBe(false)
    // beta unaffected
    expect(r.repoClaude.has('projects/beta/.claude/CLAUDE.md')).toBe(true)
  })
})

describe('sync round-trip — service file invariant', () => {
  it('service files NEVER appear in repo regardless of toggle combo', async () => {
    const combos: ClaudeConfig['syncGlobal'][] = [
      ALL_ON,
      { claudeMd: false, commands: false, skills: false, settings: false },
      { ...ALL_ON, commands: false },
    ]
    for (const syncGlobal of combos) {
      const sub = mkdtempSync(join(tmpdir(), 'cs-rt-sub-'))
      try {
        const subLayout = buildSourceFixture(sub, ['only'])
        const subRepo = join(sub, 'repo')
        initEmptyRepo(subRepo)
        const r = await roundTrip({
          layout: subLayout, repoPath: subRepo, syncGlobal,
          projects: projectsFromFixture(subLayout),
        })
        for (const banned of [
          'plugins/p.json', 'sessions/s.jsonl', 'cache/c', 'ide/i', 'statsig/x',
          'history.jsonl', '.credentials.json', 'settings.local.json',
          'CLAUDE.md.backup.20260101-120000',
        ]) expect(r.repoClaude.has(banned)).toBe(false)
        const only = subLayout.projects[0]!
        expect(r.repoClaude.has(`projects/${only.encoded}/sessions/s.jsonl`)).toBe(false)
        expect(r.repoClaude.has(`projects/${only.encoded}/foo.jsonl`)).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/settings.local.json')).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/.credentials.json')).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/scheduled_tasks.lock')).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/worktrees/wt1/x')).toBe(false)
      } finally {
        rmSync(sub, { recursive: true, force: true })
      }
    }
  })
})
```

- [ ] **Step 3: Run round-trip tests**

Run: `npx vitest run tests/main/engine/sync-roundtrip.test.ts`
Expected: ALL parametrised cases pass. If any case fails, do NOT move on — fix the engine code first (likely a missed branch in source-enum gating or pull-apply settings merge).

- [ ] **Step 4: Verify full engine suite still passes**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/main/engine`
Expected: all engine tests + round-trip tests pass.

---

## Task 7: UI — i18n + Settings tab

**Files:**
- Modify: `src/renderer/i18n/locales/en.json`
- Modify: `src/renderer/i18n/locales/ru.json`
- Modify: `src/renderer/components/Settings.tsx`

- [ ] **Step 1: Add i18n keys to `en.json`**

Insert before `"settings.claude.path.label"` (~line 130):

```json
  "settings.claude.global.title": "Global sync",
  "settings.claude.global.description": "Pick which top-level entries inside ~/.claude get pushed to the repo.",
  "settings.claude.global.claudeMd": "CLAUDE.md",
  "settings.claude.global.commands": "commands/",
  "settings.claude.global.skills": "skills/",
  "settings.claude.global.settings": "settings.json",
  "settings.claude.global.settingsHint": "Filtered: only known-safe keys are written to the repo.",
  "settings.claude.projects.memoryToggle": "memory",
  "settings.claude.projects.dotclaudeToggle": ".claude/",
  "settings.claude.projects.togglesHint": "Per-project toggles — independent of global sync.",
```

- [ ] **Step 2: Add same keys to `ru.json`**

Insert (matching position) in `src/renderer/i18n/locales/ru.json`:

```json
  "settings.claude.global.title": "Глобальный синк",
  "settings.claude.global.description": "Выберите верхнеуровневые элементы внутри ~/.claude, которые попадают в репу.",
  "settings.claude.global.claudeMd": "CLAUDE.md",
  "settings.claude.global.commands": "commands/",
  "settings.claude.global.skills": "skills/",
  "settings.claude.global.settings": "settings.json",
  "settings.claude.global.settingsHint": "Фильтр: в репу попадают только разрешённые ключи.",
  "settings.claude.projects.memoryToggle": "memory",
  "settings.claude.projects.dotclaudeToggle": ".claude/",
  "settings.claude.projects.togglesHint": "Per-project тогглы — независимы от глобального синка.",
```

- [ ] **Step 3: Write or update dictionaries test**

In `tests/renderer/dictionaries.test.ts`, the test compares en/ru key sets. Re-run after Step 2 to confirm no missing keys:

Run: `npx vitest run tests/renderer/dictionaries.test.ts`
Expected: PASS.

- [ ] **Step 4: Extend `Settings.tsx` Claude tab — Global sync block + per-project toggles**

In `src/renderer/components/Settings.tsx`:

(a) Locate the import block at top — make sure `ClaudeConfig` is imported from `@shared/api` (it likely already is via grouped imports).

(b) Extend Claude state. Add a new state hook near `const [claudeProjects, setClaudeProjects] = useState<ClaudeProject[]>([])`:

```tsx
const [claudeSyncGlobal, setClaudeSyncGlobal] = useState<ClaudeConfig['syncGlobal']>({
  claudeMd: true,
  commands: true,
  skills: true,
  settings: true,
})
```

Add `ClaudeConfig` to the imports at line 2:

```tsx
import type { ClaudeConfig, ClaudeProject, CursorConfig, CursorProject, GitHubAuthState, LocalizedMessage, UpdateInfo } from '@shared/api'
```

(c) In the `useEffect` that calls `window.api.getConfig()` (around line 67–72), update the setter:

```tsx
void window.api.getConfig().then((c) => {
  setCursor(c.cursor)
  setClaudeProjects(c.claude.projects)
  setClaudeSyncGlobal(c.claude.syncGlobal)
  setCatalogUrl(c.catalogUrl ?? '')
})
```

(d) In `save()` (around line 92–128), include `syncGlobal` in the `claude` block:

```tsx
const r = await window.api.setConfig({
  repoUrl: trimmedUrl || null,
  repoPath: finalPath,
  includeSecretsInPush: false,
  locale: preference,
  lastDismissedUpdate: existing.lastDismissedUpdate,
  claude: {
    enabled: !!trimmedTarget,
    path: trimmedTarget || null,
    projects: claudeProjects,
    syncGlobal: claudeSyncGlobal,
  },
  cursor,
  catalogUrl: trimmedCatalog || null,
})
```

(e) Inside the `{tab === 'claude' && (` block (line 255), after the path Field and before the `<Separator />` (line 272), add the Global sync section:

```tsx
<Separator />
<div className="space-y-2">
  <div>
    <h3 className="text-sm font-medium">{t('settings.claude.global.title')}</h3>
    <p className="text-xs text-muted-foreground">{t('settings.claude.global.description')}</p>
  </div>
  <div className="space-y-1.5 text-sm">
    {(['claudeMd', 'commands', 'skills', 'settings'] as const).map((key) => (
      <label key={key} className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={claudeSyncGlobal[key]}
          onChange={(e) =>
            setClaudeSyncGlobal((cur) => ({ ...cur, [key]: e.target.checked }))
          }
          className="accent-primary"
        />
        <span>{t(`settings.claude.global.${key}`)}</span>
        {key === 'settings' && (
          <span className="text-xs text-muted-foreground">
            {t('settings.claude.global.settingsHint')}
          </span>
        )}
      </label>
    ))}
  </div>
</div>
```

(f) Update the per-project row (lines 307–344). The existing row renders name + path + delete; insert a toggles row below them:

```tsx
{claudeProjects.map((p, i) => (
  <li
    key={`${p.name}-${i}`}
    className="flex w-full min-w-0 flex-col gap-1.5 rounded-md border px-3 py-2 text-sm"
  >
    <div className="flex w-full min-w-0 items-center gap-2">
      <Input
        value={p.name}
        onChange={(e) => {
          const v = e.target.value
          setClaudeProjects((arr) =>
            arr.map((it, idx) => (idx === i ? { ...it, name: v } : it)),
          )
        }}
        className="h-7 w-40 shrink-0 text-sm"
      />
      <Input
        value={p.path}
        onChange={(e) => {
          const v = e.target.value
          setClaudeProjects((arr) =>
            arr.map((it, idx) => (idx === i ? { ...it, path: v } : it)),
          )
        }}
        title={p.path}
        className="h-7 min-w-0 flex-1 font-mono text-xs"
      />
      <button
        type="button"
        onClick={() =>
          setClaudeProjects((arr) => arr.filter((_, idx) => idx !== i))
        }
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={t('settings.claude.projects.detach')}
        title={t('settings.claude.projects.detachTitle')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
    <div className="flex items-center gap-3 pl-1 text-xs">
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={p.syncMemory}
          onChange={(e) => {
            const v = e.target.checked
            setClaudeProjects((arr) =>
              arr.map((it, idx) => (idx === i ? { ...it, syncMemory: v } : it)),
            )
          }}
          className="accent-primary"
        />
        <span>{t('settings.claude.projects.memoryToggle')}</span>
      </label>
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={p.syncDotClaude}
          onChange={(e) => {
            const v = e.target.checked
            setClaudeProjects((arr) =>
              arr.map((it, idx) => (idx === i ? { ...it, syncDotClaude: v } : it)),
            )
          }}
          className="accent-primary"
        />
        <span>{t('settings.claude.projects.dotclaudeToggle')}</span>
      </label>
    </div>
  </li>
))}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json && npx eslint src tests --ext .ts,.tsx --no-error-on-unmatched-pattern`
Expected: typecheck clean, lint clean.

---

## Task 8: Final validation

**Files:**
- None (this is the global verification pass).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: 0 errors.

- [ ] **Step 2: Full lint**

Run: `npx eslint src tests --ext .ts,.tsx --no-error-on-unmatched-pattern`
Expected: 0 errors, 0 warnings (or only pre-existing warnings; new code adds none).

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: all suites pass — including engine, config, sync-roundtrip, renderer, dictionaries.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`
- Open Settings → Claude tab.
- Confirm "Global sync" section appears with 4 checkboxes, all checked.
- Confirm each registered project row has [memory] and [.claude/] sub-toggles, both checked.
- Toggle one off, click Save, reopen Settings, confirm it persisted.
- Click Push (or whatever surface change shows uncommitted state). The sync-status chip should reflect added/changed files based on toggles.

DO NOT run actual `git push` against a real remote during this manual check unless you intend to publish.

- [ ] **Step 5: Hand control back to the user**

Notify: "Implementation complete. Typecheck/lint/tests green. Manual smoke confirms toggles persist and affect sync set. No git operations performed — commit and push are yours to run when ready."

---

## Self-review notes (for the planner, not for execution)

- Spec coverage: every section of the design doc maps to a task above (Tasks 1–3 = schema/types, Task 2 = rules, Task 4 = source-enum, Task 5 = engine + pull-apply + comparator/discard, Task 6 = round-trip tests, Task 7 = UI/i18n, Task 8 = global checks).
- Placeholders: scanned — every code step contains complete, runnable code; no "TBD" or "implement later".
- Type consistency: `ClaudeGlobalSyncFlags` declared once in `api.ts` (Task 1), imported by `rules.ts` (Task 2) and `source-enum.ts` (Task 4). No duplicate declarations.
- Git-ops avoidance: confirmed — no `git add`/`git commit`/`git push` in any step; verification steps replace the standard commit-per-task closure.
