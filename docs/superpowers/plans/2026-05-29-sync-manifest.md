# Sync Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a repo-side manifest the authority for sync membership (replacing hardcoded `rules.ts` gating + `syncGlobal`/per-project toggles), with device-local activation, opt-in for newly-offered entries, and install/reverse-mirror driven from the manifest (closes F2/F3).

**Architecture:** Six small, single-responsibility modules under `src/main/sync/manifest/` (schema, synth, resolve, membership, grow — all pure; io — file I/O). The engine computes an effective manifest (`readManifest(repo) ?? synth(cfg)`), resolves device activation into a set of active entries, and feeds those to enumeration + HEAD filtering. The hardcoded service-file ignore list stays in `rules.ts` as a hard floor beneath the manifest.

**Tech Stack:** TypeScript, Electron-Vite, React, Vitest, Node fs/crypto, git plumbing.

**Spec:** [`docs/superpowers/specs/2026-05-29-sync-manifest-design.md`](../specs/2026-05-29-sync-manifest-design.md)

**User-imposed constraints (every task):**
- **No git operations.** No `git add`/`commit`/`push` steps. The user owns commits. Each task ends with verification.
- **No `Co-Authored-By`** anywhere.
- After every task run BOTH typechecks: `npx tsc --noEmit -p tsconfig.json` AND `npx tsc --noEmit -p tsconfig.node.json` (main-process files like ipc.ts/engine.ts live in the node config — the renderer config does NOT catch them). Plus `npx vitest run <relevant files>`.
- **Decomposition is a hard requirement:** keep each module one responsibility, pure where marked, independently testable. Do not collapse modules together.

---

## File Structure

**Create (source):**
- `src/main/sync/manifest/schema.ts` — types + `parseManifest`/`serializeManifest`.
- `src/main/sync/manifest/membership.ts` — path↔category table + active-entry lookup.
- `src/main/sync/manifest/synth.ts` — `synthManifest(cfg)` + `synthActivation(cfg)`.
- `src/main/sync/manifest/resolve.ts` — `resolveActiveEntries(manifest, deviceState)`.
- `src/main/sync/manifest/grow.ts` — `growManifest(repoManifest, activeLocalEntries)`.
- `src/main/sync/manifest/io.ts` — `readManifest`/`writeManifest` (atomic).

**Create (tests):**
- `tests/main/manifest/{schema,membership,synth,resolve,grow,io}.test.ts`
- `tests/main/manifest/migration.test.ts`
- `tests/main/manifest/manifest-roundtrip.test.ts`

**Modify:**
- `src/shared/api.ts` — `AppConfig` gains `manifestActivation`, `knownEntryIds`.
- `src/main/config.ts` — read/migrate the new fields.
- `src/main/sync/engine/source-enum.ts` — `enum*` take `activeEntries` (via membership) instead of `syncGlobal`.
- `src/main/sync/engine/rules.ts` — keep floor + utils; remove `isClaudePathSynced` toggle-gating (membership replaces it). Keep `isClaudePathIgnored`, `isProjectDotClaudePathSynced` (floor part), `SETTINGS_KEY_ALLOW_LIST`, encode/decode helpers, `isCursorPathSynced`.
- `src/main/sync/engine/engine.ts` — effective manifest + resolve + HEAD filter; grow+write manifest on push.
- `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/api.ts` — expose manifest + activation; set-activation handler.
- `src/renderer/components/Settings.tsx` — render toggles from manifest entries.
- `src/renderer/i18n/locales/{en,ru}.json` — new keys.
- `src/main/sync/claude.ts` + `src/main/templates/install.{sh,ps1}.template` (and their generator) — expand list from manifest (F2/F3).
- Engine/config/roundtrip tests — adapt to new signatures.

**Stable contracts (referenced across tasks):**
```ts
// schema.ts
type ManifestSurface = 'claude-global' | 'project'
type ManifestCategory = 'claudeMd' | 'commands' | 'skills' | 'settings' | 'memory' | 'dotclaude'
type ManifestFileEntry = { kind: 'file'; id: string; surface: ManifestSurface; category: ManifestCategory; project?: string; path?: string }
type ManifestCapabilityEntry = { kind: 'capability'; id: string; capability: 'plugins' | 'mcp'; data: unknown }
type ManifestEntry = ManifestFileEntry | ManifestCapabilityEntry
type Manifest = { version: 1; entries: ManifestEntry[] }
// device state (in AppConfig)
type DeviceManifestState = { activation: Record<string, boolean>; knownEntryIds: string[] }
```

---

## Task 1: `schema.ts` — types + parse/serialize

**Files:**
- Create: `src/main/sync/manifest/schema.ts`
- Create: `tests/main/manifest/schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/manifest/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseManifest, serializeManifest, type Manifest } from '../../../src/main/sync/manifest/schema'

const sample: Manifest = {
  version: 1,
  entries: [
    { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    { kind: 'file', id: 'project:erp:memory', surface: 'project', category: 'memory', project: 'erp' },
    { kind: 'capability', id: 'capability:plugins', capability: 'plugins', data: { ids: ['x'] } },
  ],
}

describe('schema parse/serialize', () => {
  it('round-trips serialize → parse', () => {
    const buf = serializeManifest(sample)
    expect(parseManifest(buf)).toEqual(sample)
  })
  it('serialize is stable, pretty JSON ending with newline', () => {
    const text = serializeManifest(sample).toString('utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('"version": 1')
  })
  it('throws on invalid JSON', () => {
    expect(() => parseManifest(Buffer.from('{ not json'))).toThrow()
  })
  it('throws on missing/unknown version', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ entries: [] })))).toThrow(/version/i)
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 2, entries: [] })))).toThrow(/version/i)
  })
  it('throws on non-array entries', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 1, entries: {} })))).toThrow(/entries/i)
  })
  it('throws on entry with unknown kind', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 1, entries: [{ kind: 'bogus', id: 'x' }] })))).toThrow()
  })
  it('throws on file entry missing required fields', () => {
    expect(() => parseManifest(Buffer.from(JSON.stringify({ version: 1, entries: [{ kind: 'file', id: 'x' }] })))).toThrow()
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/manifest/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `schema.ts`**

Create `src/main/sync/manifest/schema.ts`:

```ts
// src/main/sync/manifest/schema.ts

export type ManifestSurface = 'claude-global' | 'project'
export type ManifestCategory =
  | 'claudeMd' | 'commands' | 'skills' | 'settings'
  | 'memory' | 'dotclaude'

export type ManifestFileEntry = {
  kind: 'file'
  id: string
  surface: ManifestSurface
  category: ManifestCategory
  project?: string
  path?: string // reserved for future glob support; not matched in №2
}

export type ManifestCapabilityEntry = {
  kind: 'capability'
  id: string
  capability: 'plugins' | 'mcp'
  data: unknown
}

export type ManifestEntry = ManifestFileEntry | ManifestCapabilityEntry

export type Manifest = { version: 1; entries: ManifestEntry[] }

const CATEGORIES: ReadonlySet<string> = new Set([
  'claudeMd', 'commands', 'skills', 'settings', 'memory', 'dotclaude',
])

function isFileEntry(e: Record<string, unknown>): boolean {
  if (typeof e.id !== 'string') return false
  if (e.surface !== 'claude-global' && e.surface !== 'project') return false
  if (typeof e.category !== 'string' || !CATEGORIES.has(e.category)) return false
  if (e.surface === 'project' && typeof e.project !== 'string') return false
  return true
}

function isCapabilityEntry(e: Record<string, unknown>): boolean {
  if (typeof e.id !== 'string') return false
  if (e.capability !== 'plugins' && e.capability !== 'mcp') return false
  return true
}

/** Parse + validate a manifest buffer. Throws with a clear message on any problem. */
export function parseManifest(buf: Buffer): Manifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(buf.toString('utf8'))
  } catch (e) {
    throw new Error(`manifest: invalid JSON: ${(e as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('manifest: not an object')
  const obj = parsed as Record<string, unknown>
  if (obj.version !== 1) throw new Error(`manifest: unsupported version ${String(obj.version)} (expected 1)`)
  if (!Array.isArray(obj.entries)) throw new Error('manifest: entries must be an array')
  const entries: ManifestEntry[] = obj.entries.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`manifest: entry ${i} not an object`)
    const e = raw as Record<string, unknown>
    if (e.kind === 'file') {
      if (!isFileEntry(e)) throw new Error(`manifest: invalid file entry at ${i}`)
      const fe: ManifestFileEntry = {
        kind: 'file', id: e.id as string,
        surface: e.surface as ManifestSurface, category: e.category as ManifestCategory,
      }
      if (typeof e.project === 'string') fe.project = e.project
      if (typeof e.path === 'string') fe.path = e.path
      return fe
    }
    if (e.kind === 'capability') {
      if (!isCapabilityEntry(e)) throw new Error(`manifest: invalid capability entry at ${i}`)
      return { kind: 'capability', id: e.id as string, capability: e.capability as 'plugins' | 'mcp', data: e.data }
    }
    throw new Error(`manifest: unknown entry kind at ${i}: ${String(e.kind)}`)
  })
  return { version: 1, entries }
}

/** Stable, pretty serialization (2-space indent, trailing newline). */
export function serializeManifest(m: Manifest): Buffer {
  return Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8')
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/manifest/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/manifest/schema.test.ts`
Expected: typecheck clean; tests pass. (Manifest modules are imported by main-process code → node config.)

---

## Task 2: `membership.ts` — path↔category + active lookup

**Files:**
- Create: `src/main/sync/manifest/membership.ts`
- Create: `tests/main/manifest/membership.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/manifest/membership.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  globalPathCategory, entryId, hasActiveEntry,
} from '../../../src/main/sync/manifest/membership'
import type { ManifestEntry } from '../../../src/main/sync/manifest/schema'

describe('globalPathCategory', () => {
  it('maps top-level global paths', () => {
    expect(globalPathCategory('CLAUDE.md')).toBe('claudeMd')
    expect(globalPathCategory('settings.json')).toBe('settings')
    expect(globalPathCategory('commands/a.md')).toBe('commands')
    expect(globalPathCategory('commands/sub/b.md')).toBe('commands')
    expect(globalPathCategory('skills/foo/SKILL.md')).toBe('skills')
  })
  it('maps memory under projects/<encoded>/memory/', () => {
    expect(globalPathCategory('projects/-Users-x-erp/memory/note.md')).toBe('memory')
  })
  it('returns null for non-category paths', () => {
    expect(globalPathCategory('projects/-Users-x-erp/sessions/s.jsonl')).toBeNull()
    expect(globalPathCategory('random.txt')).toBeNull()
    expect(globalPathCategory('projects/-Users-x-erp/foo.jsonl')).toBeNull()
  })
})

describe('entryId', () => {
  it('global ids', () => {
    expect(entryId('claude-global', 'commands')).toBe('claude-global:commands')
  })
  it('project ids', () => {
    expect(entryId('project', 'memory', 'erp')).toBe('project:erp:memory')
    expect(entryId('project', 'dotclaude', 'erp')).toBe('project:erp:dotclaude')
  })
})

describe('hasActiveEntry', () => {
  const active: ManifestEntry[] = [
    { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    { kind: 'file', id: 'project:erp:memory', surface: 'project', category: 'memory', project: 'erp' },
  ]
  it('true when id present', () => {
    expect(hasActiveEntry('claude-global:commands', active)).toBe(true)
    expect(hasActiveEntry('project:erp:memory', active)).toBe(true)
  })
  it('false when absent', () => {
    expect(hasActiveEntry('claude-global:skills', active)).toBe(false)
    expect(hasActiveEntry('project:crm:memory', active)).toBe(false)
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/manifest/membership.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `membership.ts`**

Create `src/main/sync/manifest/membership.ts`:

```ts
// src/main/sync/manifest/membership.ts
import type { ManifestEntry, ManifestSurface, ManifestCategory } from './schema'

/**
 * Category of a surface-relative path under ~/.claude (the enumClaudeSource walk).
 * Covers both claude-global top-level entries and per-project memory
 * (projects/<encoded>/memory/...). Returns null for anything else.
 * NOTE: the hard ignore floor (rules.isClaudePathIgnored) is applied by the
 * caller BEFORE this; this function only classifies category membership.
 */
export function globalPathCategory(rel: string): ManifestCategory | null {
  const norm = rel.replace(/\\/g, '/')
  if (norm === 'CLAUDE.md') return 'claudeMd'
  if (norm === 'settings.json') return 'settings'
  if (norm.startsWith('commands/')) return 'commands'
  if (norm.startsWith('skills/')) return 'skills'
  if (/^projects\/[^/]+\/memory\//.test(norm)) return 'memory'
  return null
}

/** Stable entry id for a (surface, category, project?). */
export function entryId(surface: ManifestSurface, category: ManifestCategory, project?: string): string {
  return surface === 'claude-global'
    ? `claude-global:${category}`
    : `project:${project}:${category}`
}

/** Is there an active manifest entry with this id? */
export function hasActiveEntry(id: string, active: ManifestEntry[]): boolean {
  return active.some((e) => e.id === id)
}
```

(Per-project `.claude/` paths are all the single `dotclaude` category — the caller for that surface uses `entryId('project','dotclaude',name)` directly after the floor check `isProjectDotClaudePathSynced`, so no path→category function is needed there.)

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/manifest/membership.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/manifest/membership.test.ts`
Expected: clean; pass.

---

## Task 3: `synth.ts` — config → manifest + activation

**Files:**
- Create: `src/main/sync/manifest/synth.ts`
- Create: `tests/main/manifest/synth.test.ts`

**Context:** `ClaudeConfig` (from `@shared/api`) currently has `syncGlobal: { claudeMd, commands, skills, settings }` and `projects: { name, path, syncMemory, syncDotClaude }[]`.

- [ ] **Step 1: Write failing tests**

Create `tests/main/manifest/synth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { synthManifest, synthActivation } from '../../../src/main/sync/manifest/synth'
import type { ClaudeConfig } from '@shared/api'

const cfg: ClaudeConfig = {
  enabled: true, path: '/home/u/.claude',
  syncGlobal: { claudeMd: true, commands: false, skills: true, settings: true },
  projects: [
    { name: 'erp', path: '/p/erp', syncMemory: true, syncDotClaude: false },
    { name: 'crm', path: '/p/crm', syncMemory: false, syncDotClaude: true },
  ],
}

describe('synthManifest', () => {
  it('offers all 4 global categories + 2 per project (regardless of flags)', () => {
    const m = synthManifest(cfg)
    const ids = m.entries.map((e) => e.id).sort()
    expect(ids).toEqual([
      'claude-global:claudeMd', 'claude-global:commands', 'claude-global:settings', 'claude-global:skills',
      'project:crm:dotclaude', 'project:crm:memory',
      'project:erp:dotclaude', 'project:erp:memory',
    ])
    expect(m.version).toBe(1)
    expect(m.entries.every((e) => e.kind === 'file')).toBe(true)
  })
})

describe('synthActivation', () => {
  it('maps flags 1:1 to activation + lists all ids as known', () => {
    const { activation, knownEntryIds } = synthActivation(cfg)
    expect(activation).toEqual({
      'claude-global:claudeMd': true,
      'claude-global:commands': false,
      'claude-global:skills': true,
      'claude-global:settings': true,
      'project:erp:memory': true,
      'project:erp:dotclaude': false,
      'project:crm:memory': false,
      'project:crm:dotclaude': true,
    })
    expect(knownEntryIds.sort()).toEqual(Object.keys(activation).sort())
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/manifest/synth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `synth.ts`**

Create `src/main/sync/manifest/synth.ts`:

```ts
// src/main/sync/manifest/synth.ts
import type { ClaudeConfig } from '@shared/api'
import type { Manifest, ManifestFileEntry } from './schema'
import { entryId } from './membership'

const GLOBAL_CATEGORIES = ['claudeMd', 'commands', 'skills', 'settings'] as const

/** Offered set synthesized from current config: all standard categories
 *  (activation is captured separately so toggling on later needs no manifest grow). */
export function synthManifest(cfg: ClaudeConfig): Manifest {
  const entries: ManifestFileEntry[] = []
  for (const c of GLOBAL_CATEGORIES) {
    entries.push({ kind: 'file', id: entryId('claude-global', c), surface: 'claude-global', category: c })
  }
  for (const p of cfg.projects) {
    entries.push({ kind: 'file', id: entryId('project', 'memory', p.name), surface: 'project', category: 'memory', project: p.name })
    entries.push({ kind: 'file', id: entryId('project', 'dotclaude', p.name), surface: 'project', category: 'dotclaude', project: p.name })
  }
  return { version: 1, entries }
}

/** 1:1 mapping of current toggles → device activation + known ids (migration). */
export function synthActivation(cfg: ClaudeConfig): { activation: Record<string, boolean>; knownEntryIds: string[] } {
  const activation: Record<string, boolean> = {
    [entryId('claude-global', 'claudeMd')]: cfg.syncGlobal.claudeMd,
    [entryId('claude-global', 'commands')]: cfg.syncGlobal.commands,
    [entryId('claude-global', 'skills')]: cfg.syncGlobal.skills,
    [entryId('claude-global', 'settings')]: cfg.syncGlobal.settings,
  }
  for (const p of cfg.projects) {
    activation[entryId('project', 'memory', p.name)] = p.syncMemory
    activation[entryId('project', 'dotclaude', p.name)] = p.syncDotClaude
  }
  return { activation, knownEntryIds: Object.keys(activation) }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/manifest/synth.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/manifest/synth.test.ts`
Expected: clean; pass.

---

## Task 4: `resolve.ts` — offered ∩ activation

**Files:**
- Create: `src/main/sync/manifest/resolve.ts`
- Create: `tests/main/manifest/resolve.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/manifest/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveActiveEntries } from '../../../src/main/sync/manifest/resolve'
import type { Manifest } from '../../../src/main/sync/manifest/schema'

const manifest: Manifest = {
  version: 1,
  entries: [
    { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    { kind: 'file', id: 'claude-global:skills', surface: 'claude-global', category: 'skills' },
    { kind: 'capability', id: 'capability:plugins', capability: 'plugins', data: {} },
  ],
}

describe('resolveActiveEntries', () => {
  it('active = known AND activation=true; capability never active', () => {
    const { active, newEntryIds } = resolveActiveEntries(manifest, {
      activation: { 'claude-global:commands': true, 'claude-global:skills': false },
      knownEntryIds: ['claude-global:commands', 'claude-global:skills', 'capability:plugins'],
    })
    expect(active.map((e) => e.id)).toEqual(['claude-global:commands'])
    expect(newEntryIds).toEqual([])
  })
  it('new offered entry (not known) is opt-in: not active, listed in newEntryIds', () => {
    const { active, newEntryIds } = resolveActiveEntries(manifest, {
      activation: { 'claude-global:commands': true },
      knownEntryIds: ['claude-global:commands'],
    })
    expect(active.map((e) => e.id)).toEqual(['claude-global:commands'])
    expect(newEntryIds.sort()).toEqual(['capability:plugins', 'claude-global:skills'])
  })
  it('known but activation missing → treated as inactive', () => {
    const { active } = resolveActiveEntries(manifest, {
      activation: {},
      knownEntryIds: ['claude-global:commands'],
    })
    expect(active).toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/manifest/resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolve.ts`**

Create `src/main/sync/manifest/resolve.ts`:

```ts
// src/main/sync/manifest/resolve.ts
import type { Manifest, ManifestEntry } from './schema'

export type DeviceManifestState = {
  activation: Record<string, boolean>
  knownEntryIds: string[]
}

/**
 * Resolve the effective active entries for this device.
 * - Only `file` entries can be active (capability has no executor in №2).
 * - An entry is active iff it is KNOWN (device has seen it) AND activation===true.
 * - Entries not in knownEntryIds are "new offered" → opt-in (not active),
 *   surfaced via newEntryIds so the UI can prompt.
 */
export function resolveActiveEntries(
  manifest: Manifest,
  state: DeviceManifestState,
): { active: ManifestEntry[]; newEntryIds: string[] } {
  const known = new Set(state.knownEntryIds)
  const active = manifest.entries.filter(
    (e) => e.kind === 'file' && known.has(e.id) && state.activation[e.id] === true,
  )
  const newEntryIds = manifest.entries.filter((e) => !known.has(e.id)).map((e) => e.id)
  return { active, newEntryIds }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/manifest/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/manifest/resolve.test.ts`
Expected: clean; pass.

---

## Task 5: `grow.ts` — manifest delta on push

**Files:**
- Create: `src/main/sync/manifest/grow.ts`
- Create: `tests/main/manifest/grow.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/manifest/grow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { growManifest } from '../../../src/main/sync/manifest/grow'
import type { Manifest, ManifestEntry } from '../../../src/main/sync/manifest/schema'

const repo: Manifest = {
  version: 1,
  entries: [{ kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' }],
}

describe('growManifest', () => {
  it('adds active local entries missing from repo manifest', () => {
    const active: ManifestEntry[] = [
      { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
      { kind: 'file', id: 'project:erp:memory', surface: 'project', category: 'memory', project: 'erp' },
    ]
    const { manifest, addedIds } = growManifest(repo, active)
    expect(addedIds).toEqual(['project:erp:memory'])
    expect(manifest.entries.map((e) => e.id).sort()).toEqual(['claude-global:commands', 'project:erp:memory'])
  })
  it('is idempotent: no additions when all present', () => {
    const active: ManifestEntry[] = [
      { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
    ]
    const { manifest, addedIds } = growManifest(repo, active)
    expect(addedIds).toEqual([])
    expect(manifest.entries).toEqual(repo.entries)
  })
  it('never removes existing repo entries', () => {
    const { manifest } = growManifest(repo, [])
    expect(manifest.entries.map((e) => e.id)).toContain('claude-global:commands')
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/manifest/grow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `grow.ts`**

Create `src/main/sync/manifest/grow.ts`:

```ts
// src/main/sync/manifest/grow.ts
import type { Manifest, ManifestEntry } from './schema'

/**
 * Ensure every active local entry is offered in the repo manifest. Adds missing
 * ones (offered set only grows on push); never removes (removal is an explicit
 * separate action). Returns the (possibly unchanged) manifest and the ids added.
 */
export function growManifest(
  repoManifest: Manifest,
  activeLocalEntries: ManifestEntry[],
): { manifest: Manifest; addedIds: string[] } {
  const existing = new Set(repoManifest.entries.map((e) => e.id))
  const added = activeLocalEntries.filter((e) => !existing.has(e.id))
  if (added.length === 0) return { manifest: repoManifest, addedIds: [] }
  return {
    manifest: { version: 1, entries: [...repoManifest.entries, ...added] },
    addedIds: added.map((e) => e.id),
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/manifest/grow.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/manifest/grow.test.ts`
Expected: clean; pass.

---

## Task 6: `io.ts` — read/write manifest (atomic)

**Files:**
- Create: `src/main/sync/manifest/io.ts`
- Create: `tests/main/manifest/io.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/manifest/io.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readManifest, writeManifest } from '../../../src/main/sync/manifest/io'
import type { Manifest } from '../../../src/main/sync/manifest/schema'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-mio-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const m: Manifest = { version: 1, entries: [{ kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' }] }

describe('manifest io', () => {
  it('returns null when no manifest present', () => {
    expect(readManifest(dir)).toBeNull()
  })
  it('write → read round-trips', async () => {
    await writeManifest(dir, m)
    expect(readManifest(dir)).toEqual(m)
  })
  it('atomic write leaves no .tmp- residue', async () => {
    await writeManifest(dir, m)
    const csDir = join(dir, '.claudesync')
    expect(readdirSync(csDir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
  it('throws on broken manifest file (not silent null)', () => {
    mkdirSync(join(dir, '.claudesync'), { recursive: true })
    writeFileSync(join(dir, '.claudesync', 'manifest.json'), '{ broken')
    expect(() => readManifest(dir)).toThrow()
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/manifest/io.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `io.ts`**

Create `src/main/sync/manifest/io.ts`:

```ts
// src/main/sync/manifest/io.ts
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseManifest, serializeManifest, type Manifest } from './schema'

const MANIFEST_REL = join('.claudesync', 'manifest.json')

function manifestPath(repoPath: string): string {
  return join(repoPath, MANIFEST_REL)
}

let atomicCounter = 0

/** Read + parse the repo manifest. Returns null if absent. Throws on broken content. */
export function readManifest(repoPath: string): Manifest | null {
  const p = manifestPath(repoPath)
  if (!existsSync(p)) return null
  return parseManifest(readFileSync(p))
}

/** Atomic write (temp+rename) of the manifest into <repo>/.claudesync/manifest.json. */
export async function writeManifest(repoPath: string, m: Manifest): Promise<void> {
  const p = manifestPath(repoPath)
  mkdirSync(join(repoPath, '.claudesync'), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}-${atomicCounter++}`
  try {
    writeFileSync(tmp, serializeManifest(m))
    renameSync(tmp, p)
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/manifest/io.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/manifest`
Expected: clean; all 6 module suites pass.

---

## Task 7: Config — `manifestActivation` + `knownEntryIds`

**Files:**
- Modify: `src/shared/api.ts` (`AppConfig`)
- Modify: `src/main/config.ts` (reader + migration)
- Modify: `tests/main/config.test.ts`

**Context:** `config.ts` has `defaultsBase()`, `readClaudeBlock`, and a top-level config reader. Read the file first.

- [ ] **Step 1: Write failing tests**

Append to `tests/main/config.test.ts`:

```ts
describe('readConfig manifest device-state migration', () => {
  it('defaults manifestActivation/knownEntryIds to empty when absent', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ claude: { enabled: true, path: '/x', projects: [] } }))
    const cfg = readConfig(f)
    expect(cfg.manifestActivation).toEqual({})
    expect(cfg.knownEntryIds).toEqual([])
  })
  it('preserves explicit manifest device-state', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({
      claude: { enabled: true, path: '/x', projects: [] },
      manifestActivation: { 'claude-global:commands': false },
      knownEntryIds: ['claude-global:commands'],
    }))
    const cfg = readConfig(f)
    expect(cfg.manifestActivation).toEqual({ 'claude-global:commands': false })
    expect(cfg.knownEntryIds).toEqual(['claude-global:commands'])
  })
  it('writeConfig round-trips device-state', () => {
    const f = join(dir, 'config.json')
    const cfg: AppConfig = {
      ...baseDefaults,
      manifestActivation: { 'project:erp:memory': true },
      knownEntryIds: ['project:erp:memory'],
    }
    writeConfig(f, cfg)
    expect(readConfig(f).manifestActivation).toEqual({ 'project:erp:memory': true })
    expect(readConfig(f).knownEntryIds).toEqual(['project:erp:memory'])
  })
})
```

Also extend the `baseDefaults` literal at the top of the test file: add `manifestActivation: {}` and `knownEntryIds: []`.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/config.test.ts`
Expected: FAIL — TS errors (missing fields on `AppConfig`).

- [ ] **Step 3: Update `AppConfig` in `src/shared/api.ts`**

Add to the `AppConfig` type (alongside `repoPath`, `claude`, etc.):

```ts
  /** Device-local manifest activation: entryId → on/off for THIS device. */
  manifestActivation: Record<string, boolean>
  /** entryIds this device has already seen (to make newly-offered entries opt-in). */
  knownEntryIds: string[]
```

- [ ] **Step 4: Update `src/main/config.ts`**

In `defaultsBase()` add:

```ts
    manifestActivation: {},
    knownEntryIds: [],
```

Add reader helpers near the other readers:

```ts
function readManifestActivation(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}
function readKnownEntryIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}
```

In the top-level config reader (where `repoPath`, `claude`, `cursor`, etc. are assembled from `parsed`), add:

```ts
    manifestActivation: readManifestActivation(parsed.manifestActivation),
    knownEntryIds: readKnownEntryIds(parsed.knownEntryIds),
```

Ensure `writeConfig` persists them (if `writeConfig` writes the whole `AppConfig` object as JSON, they're included automatically; if it cherry-picks fields, add them).

- [ ] **Step 5: Run, expect pass**

Run: `npx vitest run tests/main/config.test.ts`
Expected: PASS (new + existing; existing tests build via `baseDefaults`).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/config.test.ts`
Expected: both typechecks clean; tests pass.

---

## Task 8: `source-enum` — membership via active entries

**Files:**
- Modify: `src/main/sync/engine/source-enum.ts`
- Modify: `tests/main/engine/source-enum.test.ts`

**Context:** `enumClaudeSource(claudePath, claudeProjects, syncGlobal)` and `enumClaudeProjectDotClaudeSource(projectPath, projectName)` currently gate by `syncGlobal`/hardcoded rules. Change them to gate by an `active: ManifestEntry[]` set using `membership`. Floor (`isClaudePathIgnored`, `isProjectDotClaudePathSynced`) stays.

- [ ] **Step 1: Write failing tests**

Append to `tests/main/engine/source-enum.test.ts` (import the manifest helpers + types):

```ts
import type { ManifestEntry } from '../../../src/main/sync/manifest/schema'

const ACTIVE_ALL_GLOBAL: ManifestEntry[] = [
  { kind: 'file', id: 'claude-global:claudeMd', surface: 'claude-global', category: 'claudeMd' },
  { kind: 'file', id: 'claude-global:commands', surface: 'claude-global', category: 'commands' },
  { kind: 'file', id: 'claude-global:skills', surface: 'claude-global', category: 'skills' },
  { kind: 'file', id: 'claude-global:settings', surface: 'claude-global', category: 'settings' },
]

describe('enumClaudeSource — manifest membership', () => {
  it('only includes categories present in active entries', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'commands'), { recursive: true })
    writeFileSync(join(claude, 'CLAUDE.md'), 'x')
    writeFileSync(join(claude, 'commands', 'a.md'), 'A')
    // active = only CLAUDE.md category
    const active: ManifestEntry[] = [{ kind: 'file', id: 'claude-global:claudeMd', surface: 'claude-global', category: 'claudeMd' }]
    const out = await enumClaudeSource(claude, [], active)
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/CLAUDE.md'])
  })
  it('memory included only when project:<name>:memory active', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    const projects = [{ name: 'p', path: 'abc', syncMemory: true, syncDotClaude: true }]
    const withMem: ManifestEntry[] = [{ kind: 'file', id: 'project:p:memory', surface: 'project', category: 'memory', project: 'p' }]
    const out1 = await enumClaudeSource(claude, projects, withMem)
    expect(out1.entries.map((e) => e.repoPath)).toEqual(['claude/projects/p/memory/n.md'])
    const out2 = await enumClaudeSource(claude, projects, []) // memory not active
    expect(out2.entries).toEqual([])
  })
})

describe('enumClaudeProjectDotClaudeSource — active gating handled by caller', () => {
  it('still enumerates .claude tree (engine decides activation by project entry)', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.claude'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'CLAUDE.md'), 'hi\n')
    const out = await enumClaudeProjectDotClaudeSource(proj, 'MyProj')
    expect(out.entries.map((e) => e.repoPath)).toEqual(['claude/projects/MyProj/.claude/CLAUDE.md'])
  })
})
```

Update existing `enumClaudeSource(..., ALL_ON)` calls in this file: replace the `syncGlobal` 3rd arg with `ACTIVE_ALL_GLOBAL` (plus the relevant `project:<name>:memory` entry when the test exercises memory). For tests asserting memory inclusion, add the matching project memory entry to the active array.

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/main/engine/source-enum.test.ts`
Expected: FAIL — signature mismatch / membership not used.

- [ ] **Step 3: Update `source-enum.ts`**

Change imports: drop `ClaudeGlobalSyncFlags`, `isClaudePathSynced`; add membership + manifest types:

```ts
import type { ManifestEntry } from '../manifest/schema'
import { globalPathCategory, entryId, hasActiveEntry } from '../manifest/membership'
import { isClaudePathIgnored, isProjectDotClaudePathSynced, encodeClaudeProjectSegment } from './rules'
```

Replace `enumClaudeSource` signature + gating. New body (keep `walk`, `EnumResult`, `unreadable` handling from №1):

```ts
export async function enumClaudeSource(
  claudePath: string,
  claudeProjects: ClaudeProject[] = [],
  active: ManifestEntry[] = [],
): Promise<EnumResult> {
  if (!existsSync(claudePath)) return { entries: [], unreadable: [] }
  const idx = projectIndex(claudeProjects)
  const out: FileEntry[] = []
  const unreadable: string[] = []

  walk(claudePath, [], (rel, abs) => {
    if (isClaudePathIgnored(rel)) return                       // hard floor first
    const cat = globalPathCategory(rel)
    if (cat === null) return
    // Resolve repoPath + the entry id this path belongs to.
    let repoPath: string
    let id: string
    if (cat === 'memory') {
      const m = rel.match(/^projects\/([^/]+)\/(memory\/.*)$/)
      if (!m) return
      const proj = idx.get(m[1]!)
      if (!proj) return                                        // unregistered project
      id = entryId('project', 'memory', proj.name)
      repoPath = `claude/projects/${proj.name}/${m[2]!}`
    } else {
      id = entryId('claude-global', cat)
      repoPath = `claude/${rel}`
    }
    if (!hasActiveEntry(id, active)) return                    // not active → skip
    let st
    try { st = statSync(abs) } catch { unreadable.push(repoPath); return }
    if (st.size > MAX_BYTES) { unreadable.push(repoPath); return }
    let content: Buffer
    try { content = readFileSync(abs) } catch { unreadable.push(repoPath); return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { unreadable.push(repoPath); return }
    }
    out.push({ repoPath, surfacePath: rel, sha1: sha1OfBlob(content), mode: '100644', size: content.length })
  })
  return { entries: out, unreadable }
}
```

`enumClaudeProjectDotClaudeSource` keeps its current shape (it already floors via `isProjectDotClaudePathSynced`); the engine decides whether to call it at all based on whether `project:<name>:dotclaude` is active. No signature change needed beyond what №1 set. (`enumCursorProjectSource` unchanged — Cursor isn't manifest-driven in №2.)

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/main/engine/source-enum.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/engine/source-enum.test.ts`
Expected: source-enum tests pass. `tsc` will report errors at `engine.ts`/`claude.ts` callers (still pass `syncGlobal`) — fixed in Task 9/10. That's expected for this task boundary.

---

## Task 9: Engine — effective manifest, resolve, HEAD filter, grow on push

**Files:**
- Modify: `src/main/sync/engine/engine.ts`
- Modify: `tests/main/engine/engine-refresh.test.ts`, `engine-push.test.ts` (signature updates)

**Context:** Read `engine.ts` `refreshStatus` and `executePush` first (they were updated in №1). `RefreshArgs` currently carries `syncGlobal`. We replace the membership source with the manifest.

- [ ] **Step 1: Update `RefreshArgs` and add manifest resolution**

Add imports:

```ts
import { readManifest, writeManifest } from '../manifest/io'
import { synthManifest, synthActivation } from '../manifest/synth'
import { resolveActiveEntries } from '../manifest/resolve'
import { growManifest } from '../manifest/grow'
import { entryId } from '../manifest/membership'
import type { ManifestEntry } from '../manifest/schema'
import type { ClaudeConfig } from '@shared/api'
```

Change `RefreshArgs`: replace `syncGlobal: ClaudeConfig['syncGlobal']` with the device manifest state + the config needed for synth fallback:

```ts
  /** Device-local manifest activation + seen ids. */
  manifestActivation: Record<string, boolean>
  knownEntryIds: string[]
  /** Used only to synthesize a manifest when the repo has none yet (bootstrap). */
  claudeConfigForSynth: ClaudeConfig
```

Add a helper to compute the effective active entries:

```ts
function effectiveActiveEntries(args: RefreshArgs): {
  active: ManifestEntry[]
  effectiveManifest: import('../manifest/schema').Manifest
} {
  const repoManifest = args.repoPath ? readManifest(args.repoPath) : null
  const effectiveManifest = repoManifest ?? synthManifest(args.claudeConfigForSynth)
  // Bootstrap: when device has no known ids yet, treat all offered as known+active
  // (first connection default = all ON), per spec §5.4.
  let state = { activation: args.manifestActivation, knownEntryIds: args.knownEntryIds }
  if (args.knownEntryIds.length === 0) {
    const seeded: Record<string, boolean> = {}
    for (const e of effectiveManifest.entries) if (e.kind === 'file') seeded[e.id] = true
    state = { activation: { ...seeded, ...args.manifestActivation }, knownEntryIds: effectiveManifest.entries.map((e) => e.id) }
  }
  const { active } = resolveActiveEntries(effectiveManifest, state)
  return { active, effectiveManifest }
}
```

- [ ] **Step 2: Rewrite the Claude section of `refreshStatus`**

Replace the `enumClaudeSource(..., args.syncGlobal)` call and the per-project dotClaude loop with active-entry-driven logic. Key changes:

```ts
const { active } = effectiveActiveEntries(args)
const globalRes = await enumClaudeSource(claudePath, args.claudeProjects, active)
for (const u of globalRes.unreadable) unreadableSet.add(u)
for (const f of globalRes.entries) { /* same memory-vs-global ref classification as №1 */ }
for (const proj of args.claudeProjects) {
  if (!active.some((e) => e.id === entryId('project', 'dotclaude', proj.name))) continue
  const dotRes = await enumClaudeProjectDotClaudeSource(proj.path, proj.name)
  /* same accumulation as №1 */
}
```

Replace the HEAD-filter (currently keyed on `args.syncGlobal.*` and project flags) with active-entry checks. For each HEAD repoPath, compute its entry id (global category via the `claude/<rel>` shape; project memory → `project:<name>:memory`; project dotclaude → `project:<name>:dotclaude`) and keep it only if that id is in `active`. Reuse the existing `refForRepoPath` helper; add an id derivation mirroring `entryId`. This preserves the №1 symmetry (inactive entry excluded from both sides → no phantom deletions).

- [ ] **Step 3: grow + write manifest on push**

In `executePush`, after the floor check and before/after building the commit, ensure offered set grows. Concretely: compute `active` (file entries) for this device, `growManifest(effectiveManifest, active)`, and if `addedIds.length > 0` write the manifest file via `writeManifest(repoPath, grown)` BEFORE `buildAndCommitFromSource` so the manifest file is part of the working tree and gets committed alongside content. (The build commits the whole source set; the manifest at `.claudesync/manifest.json` is outside `claude/`/`cursor/` so confirm the commit includes it — if `buildAndCommitFromSource` only stages `claude/`+`cursor/`, add `.claudesync/manifest.json` to its staged paths. Read `index-builder.ts` to confirm staging scope and extend it to include `.claudesync/` if needed.)

- [ ] **Step 4: Update all `RefreshArgs`/`PushArgs` construction sites + tests**

`grep` for `syncGlobal:` across `src/main` and `tests` and replace each `RefreshArgs`/`PushArgs` literal's `syncGlobal: ...` with:

```ts
manifestActivation: cfg.manifestActivation,
knownEntryIds: cfg.knownEntryIds,
claudeConfigForSynth: cfg.claude,
```

(In tests, construct a minimal `ClaudeConfig` for `claudeConfigForSynth` and the activation map matching the scenario; for "all on" use `synthActivation(cfg)`.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/engine`
Expected: both clean; engine tests pass. Fix any phantom-deletion regressions by checking the HEAD-filter id derivation matches the active-entry ids exactly.

---

## Task 10: Install / reverse-mirror from manifest (F2/F3)

**Files:**
- Modify: `src/main/sync/claude.ts` (and/or the install-script generator) + `src/main/templates/install.{sh,ps1}.template`
- Modify: relevant install tests (`tests/main/sync-claude.test.ts`, `init-wizard.test.ts`)

**Context:** Read `claude.ts` and the install templates first. The install scripts currently hardcode the expand list (global + `projects/*/memory`), missing `projects/<name>/.claude/`. Derive the expand list from the manifest's file entries instead.

- [ ] **Step 1: Write failing test**

Add a test (in `tests/main/sync-claude.test.ts` or a new `tests/main/sync/install-from-manifest.test.ts`) asserting that, given a manifest with `project:erp:dotclaude` active, the generated install plan/script includes the `projects/erp/.claude/` expansion (F2), and that a nested `commands/sub/foo.md` is covered by the `commands` category expansion (F3).

(Exact assertion shape depends on the generator's surface — if the generator returns a list of (repoPath → targetPath) pairs, assert membership of the dotclaude + nested-commands paths. If it only emits a script string, assert the script contains the project `.claude` path. Read the current generator to choose.)

- [ ] **Step 2: Run, expect failure** — `npx vitest run <the test>`

- [ ] **Step 3: Implement** — make the install path-expansion derive from the manifest's active file entries (reuse `membership`/`entryId` to enumerate which categories/projects to expand). Ensure project `.claude/` and nested category subdirs are included.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/main/sync-claude.test.ts tests/main/init-wizard.test.ts`
Expected: clean; pass.

---

## Task 11: UI — Settings from manifest + IPC + i18n

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/api.ts` (AppApi)
- Modify: `src/renderer/components/Settings.tsx`
- Modify: `src/renderer/i18n/locales/{en,ru}.json`

- [ ] **Step 1: IPC — expose offered entries + activation**

Add an IPC handler `get-manifest-view` returning `{ entries: ManifestEntry[]; activation: Record<string,boolean>; newEntryIds: string[] }` computed from `readManifest(repo) ?? synth(cfg)` + device state via `resolveActiveEntries`. Add a `set-manifest-activation` handler `(entryId: string, on: boolean)` that updates `cfg.manifestActivation[entryId]` and ensures `entryId ∈ knownEntryIds`, then `writeConfig`. Wire both in `preload/index.ts` and `AppApi` (`src/shared/api.ts`).

- [ ] **Step 2: Settings UI**

Replace the hardcoded `syncGlobal`/per-project toggle block in `Settings.tsx` (the flexible-toggles UI) with a manifest-driven list: render each `file` entry with a checkbox bound to `activation[id]`; show a "new / available" badge for ids in `newEntryIds` (checkbox off until enabled); render `capability` entries as a disabled "coming soon" row. On toggle, call `window.api.setManifestActivation(id, on)` and refresh.

- [ ] **Step 3: i18n**

Add keys to `en.json` + `ru.json` (matching the project's `{{var}}` interpolation style): `settings.manifest.title`, `settings.manifest.newBadge`, `settings.manifest.capabilitySoon`, and category labels reusing existing where possible. Run `npx vitest run tests/renderer/dictionaries.test.ts` → must pass (en/ru parity).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/renderer/dictionaries.test.ts && npx eslint src tests --ext .ts,.tsx --no-error-on-unmatched-pattern`
Expected: both typechecks clean; dictionaries pass; lint clean.

---

## Task 12: Integration round-trip + final validation

**Files:**
- Create: `tests/main/manifest/manifest-roundtrip.test.ts`, `tests/main/manifest/migration.test.ts`

- [ ] **Step 1: Migration test**

Create `tests/main/manifest/migration.test.ts`: a legacy `ClaudeConfig` (with `syncGlobal` flags + projects) → `synthManifest` + `synthActivation` → assert the resulting manifest+activation reproduce the same active set as the old toggles (1:1). Assert: an inactive flag (e.g. `commands:false`) yields an offered-but-inactive entry, never a missing one.

- [ ] **Step 2: Manifest round-trip integration test**

Create `tests/main/manifest/manifest-roundtrip.test.ts` reusing `tests/fixtures/sync-roundtrip.ts` helpers: build fixture → `synthManifest`/`synthActivation` → `writeManifest` → `resolveActiveEntries` → enum via active entries → push → pull → assert byte-identical synced content, service files absent, and that toggling an entry off removes exactly its category from both repo and target (no phantom deletions of other categories).

- [ ] **Step 3: Full validation**

Run:
```
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
npx eslint src tests --ext .ts,.tsx --no-error-on-unmatched-pattern
npx vitest run
```
Expected: both typechecks 0 errors; lint clean; all suites pass EXCEPT pre-existing Windows-only `tests/main/safe-storage.test.ts` file-mode failures (unrelated). If `regression-no-phantom-after-pull.test.ts` or other git-heavy suites time out under parallel load, re-run them in isolation with `--testTimeout=30000` — they must pass.

- [ ] **Step 4: Manual smoke (no real push)**

Run: `npm run dev`. Open Settings → Claude: confirm the sync list renders from the manifest (categories + per-project entries), toggling persists, a freshly-added project appears, and the chip reflects active categories. Do NOT push to a real remote.

- [ ] **Step 5: Hand back**

Notify: "Sub-project №2 (manifest authority) complete. 6 pure modules + io, manifest-driven membership/install, migration 1:1, opt-in for new entries. Both typechecks + lint + tests green (except pre-existing Windows safe-storage). No git operations performed — commit is yours."

---

## Self-Review notes

- **Spec coverage:** schema/synth/resolve/membership/grow/io = Tasks 1-6; config device-state = Task 7; membership-driven enum = Task 8; engine resolve+HEAD-filter+grow = Task 9; F2/F3 install = Task 10; UI/IPC = Task 11; migration+roundtrip+validation = Task 12. All §3-§8 spec sections mapped.
- **Decomposition requirement:** each module is its own file + own test; pure modules have no I/O. Satisfies the user's "fully independent units" constraint.
- **Placeholder scan:** Tasks 1-7 have complete code. Tasks 8-11 give exact contracts + key code + "read current file" where the edit depends on №1's current shape (engine/install/UI follow established patterns from the №1 plan). Task 10/11 assertion shapes are conditional on the current generator/UI surface — flagged explicitly to read first; this is guidance, not a hidden TODO.
- **Type consistency:** `Manifest`, `ManifestEntry`, `entryId`, `resolveActiveEntries`, `DeviceManifestState` shape (`activation`+`knownEntryIds`), `manifestActivation`/`knownEntryIds` config fields, `claudeConfigForSynth` — consistent across tasks.
- **Git avoidance:** no git write steps; both-tsconfig verification every task.
- **Safety:** floor stays first in enum; broken manifest throws (Task 1/6) rather than yielding empty membership; symmetry preserved in HEAD filter (Task 9).
