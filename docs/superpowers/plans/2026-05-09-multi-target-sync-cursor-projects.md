# Multi-target sync (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cursor as a second sync subject alongside Claude Code, with its own Settings tab and a per-project sync model. Backwards-compatible with existing `rulesTarget` configs and 0.8.x repos.

**Architecture:** Two independent feature modules under `src/main/sync/`. The push pipeline runs each enabled exporter sequentially against the same git repo. Schema replaces single `rulesTarget` with two blocks (`claude`, `cursor`); old field is migrated on read and dropped on write. Settings UI splits into three tabs (Repository, Claude, Cursor).

**Tech Stack:** TypeScript, Electron 32, React + Vite renderer, Vitest. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-09-multi-target-sync-cursor-projects-design.md`

---

## File Map

**Created:**
- `src/main/sync/claude.ts` — Claude exporter (extracted from `push.ts` and `init-wizard.ts`)
- `src/main/sync/cursor.ts` — new Cursor exporter
- `src/main/sync/cursor-validation.ts` — validation helpers for `CursorProject`
- `src/renderer/components/SettingsTabs.tsx` — tab container
- `src/renderer/components/settings/RepositoryTab.tsx`
- `src/renderer/components/settings/ClaudeTab.tsx`
- `src/renderer/components/settings/CursorTab.tsx`
- `src/renderer/components/settings/AddCursorProjectDialog.tsx`
- `tests/main/sync-claude.test.ts`
- `tests/main/sync-cursor.test.ts`
- `tests/main/cursor-validation.test.ts`

**Modified:**
- `src/shared/api.ts` — schema, `AppApi` surface
- `src/main/config.ts` — read migration, write new shape
- `src/main/push.ts` — pipeline branches on `cfg.claude` / `cfg.cursor`
- `src/main/init-wizard.ts` — `InitRepoOpts` carries `claude` block; calls Claude exporter
- `src/main/ipc.ts` — handler renames + new Cursor handlers
- `src/main/plugins.ts` — reads `cfg.claude.path` instead of `cfg.rulesTarget`
- `src/preload/index.ts` — match new IPC surface
- `src/renderer/components/Settings.tsx` — replaced by `SettingsTabs`
- `src/renderer/components/InitWizard.tsx` — drop `rulesTarget` field, add target-selection step
- `src/renderer/hooks/useAppState.ts` — drop `rulesTarget`, expose `claude`/`cursor`
- `src/renderer/i18n/locales/en.json`, `ru.json` — Cursor strings
- `tests/main/config.test.ts` — migration test cases
- `tests/main/push.test.ts` — multi-target pipeline test
- `tests/main/init-wizard.test.ts` — adjust to new opts shape

---

## Task 1: Schema — `AppConfig` shape and migration on read

**Files:**
- Modify: `src/shared/api.ts`
- Modify: `src/main/config.ts`
- Modify: `tests/main/config.test.ts`

- [ ] **Step 1.1: Add new types to `src/shared/api.ts`**

Insert near the existing `AppConfig` type:

```ts
export type CursorProject = {
  name: string
  path: string
}

export type ClaudeConfig = {
  enabled: boolean
  path: string | null
}

export type CursorConfig = {
  enabled: boolean
  projects: CursorProject[]
}
```

Replace the body of `AppConfig` with:

```ts
export type AppConfig = {
  repoPath: string | null
  repoUrl: string | null
  includeSecretsInPush: boolean
  locale: 'en' | 'ru' | null
  lastDismissedUpdate: string | null
  claude: ClaudeConfig
  cursor: CursorConfig
  /** Legacy field, migrated into `claude` on read, never written. */
  rulesTarget?: string | null
}
```

- [ ] **Step 1.2: Write failing migration tests in `tests/main/config.test.ts`**

Append to the file:

```ts
describe('readConfig migration to multi-target', () => {
  it('migrates legacy rulesTarget into claude block', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({
      repoPath: '/some/path',
      repoUrl: 'https://github.com/org/repo',
      rulesTarget: '/home/user/.claude',
    }))
    const cfg = readConfig(f)
    expect(cfg.claude).toEqual({ enabled: true, path: '/home/user/.claude' })
    expect(cfg.cursor).toEqual({ enabled: false, projects: [] })
  })

  it('uses claude/cursor blocks when present (no migration)', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({
      repoPath: '/p',
      repoUrl: null,
      claude: { enabled: false, path: '/x/.claude' },
      cursor: { enabled: true, projects: [{ name: 'app', path: '/repos/app' }] },
    }))
    const cfg = readConfig(f)
    expect(cfg.claude).toEqual({ enabled: false, path: '/x/.claude' })
    expect(cfg.cursor.projects).toEqual([{ name: 'app', path: '/repos/app' }])
  })

  it('returns disabled defaults when no rulesTarget and no blocks', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/p' }))
    const cfg = readConfig(f)
    expect(cfg.claude).toEqual({ enabled: false, path: null })
    expect(cfg.cursor).toEqual({ enabled: false, projects: [] })
  })

  it('writeConfig drops rulesTarget from disk', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ rulesTarget: '/legacy' }))
    const cfg = readConfig(f)
    writeConfig(f, cfg)
    const raw = JSON.parse(readFileSync(f, 'utf8'))
    expect(raw.rulesTarget).toBeUndefined()
    expect(raw.claude).toEqual({ enabled: true, path: '/legacy' })
  })
})
```

Add `readFileSync` to the imports of `tests/main/config.test.ts` if missing.

- [ ] **Step 1.3: Run tests to verify they fail**

```bash
npx vitest run tests/main/config.test.ts
```

Expected: 4 new tests fail (compile errors about `cfg.claude` not existing, or runtime mismatches).

- [ ] **Step 1.4: Update existing config.test.ts assertions**

Existing tests like `it('returns all-null when file does not exist', ...)` assert `{ rulesTarget: null }` directly. Update them to use the new shape. Search for `rulesTarget:` in `tests/main/config.test.ts`; for each `expect(...).toEqual({ ... rulesTarget: X ... })`, change to also include `claude: { enabled: !!X, path: X }, cursor: { enabled: false, projects: [] }` and remove `rulesTarget` from the literal (since `writeConfig` will not preserve it).

For example, in the "returns all-null when file does not exist" test:

```ts
// Before:
expect(readConfig(join(dir, 'config.json'))).toEqual({
  repoPath: null, repoUrl: null, rulesTarget: null,
  includeSecretsInPush: false, locale: null, lastDismissedUpdate: null,
})
// After:
expect(readConfig(join(dir, 'config.json'))).toEqual({
  repoPath: null, repoUrl: null,
  includeSecretsInPush: false, locale: null, lastDismissedUpdate: null,
  claude: { enabled: false, path: null },
  cursor: { enabled: false, projects: [] },
})
```

For the legacy `rulesTarget`-bearing tests, expect `claude.enabled: true, claude.path: '<the-rulesTarget>'`.

- [ ] **Step 1.5: Implement migration in `src/main/config.ts`**

Replace `readConfig` with:

```ts
export function readConfig(filePath: string): AppConfig {
  const baseDefaults = {
    repoPath: null,
    repoUrl: null,
    includeSecretsInPush: false,
    locale: null as 'en' | 'ru' | null,
    lastDismissedUpdate: null,
    claude: { enabled: false, path: null as string | null },
    cursor: { enabled: false, projects: [] as CursorProject[] },
  } satisfies AppConfig

  if (!existsSync(filePath)) return { ...baseDefaults }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return { ...baseDefaults }
  }
  const locale = parsed.locale === 'en' || parsed.locale === 'ru' ? parsed.locale : null
  const repoPath = typeof parsed.repoPath === 'string' ? parsed.repoPath : null
  const repoUrl = typeof parsed.repoUrl === 'string' ? parsed.repoUrl : null
  const includeSecretsInPush = parsed.includeSecretsInPush === true
  const lastDismissedUpdate = typeof parsed.lastDismissedUpdate === 'string' ? parsed.lastDismissedUpdate : null

  const claude = readClaudeBlock(parsed)
  const cursor = readCursorBlock(parsed)

  return {
    repoPath, repoUrl, includeSecretsInPush, locale, lastDismissedUpdate, claude, cursor,
  }
}

function readClaudeBlock(parsed: Record<string, unknown>): ClaudeConfig {
  const block = parsed.claude
  if (block && typeof block === 'object' && 'enabled' in block) {
    const b = block as Record<string, unknown>
    return {
      enabled: b.enabled === true,
      path: typeof b.path === 'string' ? b.path : null,
    }
  }
  // Migrate from legacy rulesTarget
  if (typeof parsed.rulesTarget === 'string') {
    return { enabled: true, path: parsed.rulesTarget }
  }
  return { enabled: false, path: null }
}

function readCursorBlock(parsed: Record<string, unknown>): CursorConfig {
  const block = parsed.cursor
  if (block && typeof block === 'object' && 'enabled' in block) {
    const b = block as Record<string, unknown>
    const projects: CursorProject[] = Array.isArray(b.projects)
      ? b.projects.flatMap((p): CursorProject[] => {
          if (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string' && typeof (p as { path?: unknown }).path === 'string') {
            return [{ name: (p as { name: string }).name, path: (p as { path: string }).path }]
          }
          return []
        })
      : []
    return { enabled: b.enabled === true, projects }
  }
  return { enabled: false, projects: [] }
}
```

Update `writeConfig` to drop the legacy field (it already serializes only the canonical shape; ensure `rulesTarget` isn't passed through):

```ts
export function writeConfig(filePath: string, cfg: AppConfig): void {
  const tmp = `${filePath}.tmp`
  const persisted: Omit<AppConfig, 'rulesTarget'> = {
    repoPath: cfg.repoPath,
    repoUrl: cfg.repoUrl,
    includeSecretsInPush: cfg.includeSecretsInPush,
    locale: cfg.locale,
    lastDismissedUpdate: cfg.lastDismissedUpdate,
    claude: cfg.claude,
    cursor: cfg.cursor,
  }
  writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf8')
  renameSync(tmp, filePath)
}
```

Add the import at top of `config.ts`:

```ts
import type { AppConfig, ClaudeConfig, CursorConfig, CursorProject, LocalizedMessage } from '@shared/api'
```

- [ ] **Step 1.6: Run config tests**

```bash
npx vitest run tests/main/config.test.ts
```

Expected: all green.

- [ ] **Step 1.7: Add `validateClaudePath` and `validateCursorProject` helpers in `config.ts`**

Replace `validateRulesTarget` with `validateClaudePath` (same implementation, just renamed):

```ts
export function validateClaudePath(p: string | null): ValidationResult {
  if (!p) return { ok: false, error: { key: 'config.error.targetRequired' } }
  const expanded = expandTilde(p)
  if (!isAbsolute(expanded)) return { ok: false, error: { key: 'config.error.targetAbsolute' } }
  return { ok: true }
}
```

Add:

```ts
const INVALID_NAME_CHARS = /[<>:"/\\|?*]/
export function validateCursorProject(p: { name: string; path: string }): ValidationResult {
  const name = p.name.trim()
  if (!name) return { ok: false, error: { key: 'cursor.error.nameRequired' } }
  if (name === '.' || name === '..') return { ok: false, error: { key: 'cursor.error.nameReserved' } }
  if (INVALID_NAME_CHARS.test(name) || name !== p.name) {
    return { ok: false, error: { key: 'cursor.error.nameInvalid' } }
  }
  if (!p.path) return { ok: false, error: { key: 'cursor.error.pathRequired' } }
  const expanded = expandTilde(p.path)
  if (!isAbsolute(expanded)) return { ok: false, error: { key: 'cursor.error.pathAbsolute' } }
  if (!existsSync(expanded)) return { ok: false, error: { key: 'cursor.error.pathMissing' } }
  try {
    if (!statSync(expanded).isDirectory()) {
      return { ok: false, error: { key: 'cursor.error.pathNotDir' } }
    }
  } catch (e) {
    return { ok: false, error: { key: 'cursor.error.pathStat', fallback: (e as Error).message } }
  }
  return { ok: true }
}
```

Find existing usages of `validateRulesTarget` (`grep -rn validateRulesTarget src tests`) and rename them to `validateClaudePath` everywhere. Caller in `src/main/ipc.ts` must pass `cfg.claude.path`. Caller in tests must update accordingly.

- [ ] **Step 1.8: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. Fix any caller that still references `cfg.rulesTarget` or `validateRulesTarget` — leave those for the next task if they belong elsewhere.

- [ ] **Step 1.9: Commit**

```bash
git add src/shared/api.ts src/main/config.ts tests/main/config.test.ts
git commit -m "refactor(config): introduce claude/cursor blocks, migrate legacy rulesTarget"
```

---

## Task 2: Extract Claude exporter to `src/main/sync/claude.ts`

**Files:**
- Create: `src/main/sync/claude.ts`
- Modify: `src/main/push.ts`, `src/main/init-wizard.ts`
- Create: `tests/main/sync-claude.test.ts`

This is a pure refactor — no behavioral change. Move `exportRulesToRepo` and `generateGlobalStructure` (which are near-duplicates), unify into one function, update callers.

- [ ] **Step 2.1: Create `src/main/sync/claude.ts` with extracted helpers**

```ts
import {
  existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
  realpathSync, rmSync, statSync, cpSync,
} from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'

const IGNORED_NAME = /\.backup\.\d|^\.DS_Store$|^Thumbs\.db$/i
const isIgnored = (n: string) => IGNORED_NAME.test(n)

function isSamePath(src: string, dst: string): boolean {
  try {
    const realSrc = realpathSync(src)
    const realDst = existsSync(dst) ? realpathSync(dst) : resolvePath(dst)
    return realSrc === realDst
  } catch { return false }
}

function syncFile(src: string, dst: string): void {
  if (!existsSync(src)) return
  if (isSamePath(src, dst)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function syncDirMirror(src: string, dst: string): void {
  if (!existsSync(src)) {
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    return
  }
  if (isSamePath(src, dst)) return
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst)) {
      if (isIgnored(entry) || !existsSync(join(src, entry))) {
        rmSync(join(dst, entry), { recursive: true, force: true })
      }
    }
  }
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (isIgnored(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    if (isSamePath(s, d)) continue
    const stat = statSync(s)
    if (stat.isDirectory()) syncDirMirror(s, d)
    else cpSync(s, d)
  }
}

function syncProjectsMemoryOnly(src: string, dst: string): void {
  if (!existsSync(src)) return
  for (const projectDir of readdirSync(src)) {
    const projectMemorySrc = join(src, projectDir, 'memory')
    const projectMemoryDst = join(dst, projectDir, 'memory')
    if (existsSync(projectMemorySrc)) {
      syncDirMirror(projectMemorySrc, projectMemoryDst)
    }
  }
}

export type ClaudeInstallMode = 'symlink' | 'copy'

export function detectClaudeInstallMode(claudePath: string): ClaudeInstallMode {
  const probe = join(claudePath, 'CLAUDE.md')
  if (!existsSync(probe)) return 'copy'
  try {
    if (lstatSync(probe).isSymbolicLink()) return 'symlink'
  } catch {}
  return 'copy'
}

/** Mirror Claude's user-global config tree into <repoPath>/global/. */
export function exportClaude(claudePath: string, repoPath: string): void {
  const dest = join(repoPath, 'global')
  mkdirSync(dest, { recursive: true })

  syncFile(join(claudePath, 'CLAUDE.md'), join(dest, 'CLAUDE.md'))
  syncFile(join(claudePath, 'settings.json'), join(dest, 'settings.json'))
  syncDirMirror(join(claudePath, 'commands'), join(dest, 'commands'))
  syncDirMirror(join(claudePath, 'skills'), join(dest, 'skills'))
  syncProjectsMemoryOnly(join(claudePath, 'projects'), join(dest, 'projects'))
}

/** Init-wizard variant: copy with secrets stripped from settings.json. */
export function generateClaudeStructure(claudePath: string, repoPath: string): void {
  const dest = join(repoPath, 'global')
  mkdirSync(dest, { recursive: true })

  if (existsSync(join(claudePath, 'CLAUDE.md'))) {
    cpSync(join(claudePath, 'CLAUDE.md'), join(dest, 'CLAUDE.md'))
  }
  const settingsSrc = join(claudePath, 'settings.json')
  if (existsSync(settingsSrc)) {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(readFileSync(settingsSrc, 'utf8')) } catch { parsed = {} }
    delete parsed.env
    writeFileSync(join(dest, 'settings.json'), JSON.stringify(parsed, null, 2), 'utf8')
  }
  if (existsSync(join(claudePath, 'commands'))) {
    cpSync(join(claudePath, 'commands'), join(dest, 'commands'), { recursive: true })
  }
  if (existsSync(join(claudePath, 'skills'))) {
    cpSync(join(claudePath, 'skills'), join(dest, 'skills'), { recursive: true })
  }
  const projectsSrc = join(claudePath, 'projects')
  if (existsSync(projectsSrc)) {
    for (const dir of readdirSync(projectsSrc)) {
      const src = join(projectsSrc, dir, 'memory')
      const dst = join(dest, dir, 'memory')  // FIXME below
      if (existsSync(src)) {
        mkdirSync(dst, { recursive: true })
        cpSync(src, dst, { recursive: true })
      }
    }
  }
}

export function stripSecretsInClaudeRepo(repoPath: string): void {
  const settingsPath = join(repoPath, 'global', 'settings.json')
  if (!existsSync(settingsPath)) return
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) }
  catch { throw new Error('Invalid JSON in global/settings.json — fix it before push') }
  if ('env' in parsed) {
    delete parsed.env
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2), 'utf8')
  }
}
```

Note: in `generateClaudeStructure`, the legacy `init-wizard.ts` code copies projects into `globalDir/<dir>/memory` (without the intermediate `projects/`). Look at original line 158-167 to see whether it should be `join(dest, 'projects', dir, 'memory')` instead. Match the original behavior exactly — do not silently fix bugs in this refactor task.

After careful re-read of `init-wizard.ts:159-167`, the original is:

```ts
const projectsDst = join(globalDir, 'projects')
...
const dst = join(projectsDst, dir, 'memory')
```

So the correct path is `join(dest, 'projects', dir, 'memory')`. Fix the snippet above to match — replace the FIXME line.

- [ ] **Step 2.2: Update `src/main/push.ts` to delegate**

Remove the local copies of `IGNORED_NAME`, `isIgnored`, `isSamePath`, `syncFile`, `syncDirMirror`, `syncProjectsMemoryOnly`, `exportRulesToRepo`, `stripSecretsInRepo`, `detectInstallMode`. Replace with imports:

```ts
import { detectClaudeInstallMode, exportClaude, stripSecretsInClaudeRepo } from './sync/claude'
```

In `runPush`, replace the call sites:

```ts
// was: if (detectInstallMode(rulesTarget, repoPath) === 'copy') { exportRulesToRepo(rulesTarget, repoPath) }
// becomes:
if (cfg.claude.enabled && cfg.claude.path) {
  if (detectClaudeInstallMode(cfg.claude.path) === 'copy') {
    exportClaude(cfg.claude.path, repoPath)
  }
}
// was: stripSecretsInRepo(repoPath)
// becomes:
stripSecretsInClaudeRepo(repoPath)
```

Update the early-return guard at the top of `runPush`:

```ts
if (!cfg.repoUrl || !cfg.repoPath) {
  return failResult({ key: 'push.error.notConfigured' })
}
if (!cfg.claude.enabled && !cfg.cursor.enabled) {
  return failResult({ key: 'push.error.nothingEnabled' })
}
```

Re-export `detectInstallMode` shim (some tests/IPC may reference it):

```ts
export { detectClaudeInstallMode as detectInstallMode } from './sync/claude'
```

Or update the callers — see Task 5 (IPC).

- [ ] **Step 2.3: Update `src/main/init-wizard.ts` to delegate**

Remove the local helpers (`copyFileIfExists`, `copyDirIfExists`, `generateGlobalStructure`). Replace with:

```ts
import { generateClaudeStructure } from './sync/claude'
```

Replace the call:

```ts
// was: generateGlobalStructure(opts.rulesTarget, localPath)
// becomes:
if (opts.claude && opts.claude.path) {
  generateClaudeStructure(opts.claude.path, localPath)
}
```

Update `InitRepoOpts`:

```ts
export type InitRepoOpts = {
  ownerLogin: string
  name: string
  isPrivate: boolean
  description?: string
  claude: { enabled: boolean; path: string | null }
  // future: cursor: { enabled: boolean; projects: CursorProject[] }
  userDataDir: string
  tplDir: string
  emit: (line: LogLine) => void
  emitStep: (e: { step: InitStep; status: StepStatus; message?: LocalizedMessage }) => void
}
```

Drop the `rulesTarget` field. Update its callers in Task 5.

- [ ] **Step 2.4: Write failing test in `tests/main/sync-claude.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportClaude, generateClaudeStructure, stripSecretsInClaudeRepo } from '../../src/main/sync/claude'

let dir: string
let claudePath: string
let repoPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-'))
  claudePath = join(dir, 'claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath, { recursive: true })
  mkdirSync(repoPath, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('exportClaude', () => {
  it('mirrors CLAUDE.md, settings.json, commands/, skills/ into <repo>/global/', () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello')
    writeFileSync(join(claudePath, 'settings.json'), '{"k":1}')
    mkdirSync(join(claudePath, 'commands'))
    writeFileSync(join(claudePath, 'commands', 'a.md'), 'A')
    mkdirSync(join(claudePath, 'skills', 's'), { recursive: true })
    writeFileSync(join(claudePath, 'skills', 's', 'SKILL.md'), 'S')

    exportClaude(claudePath, repoPath)

    expect(readFileSync(join(repoPath, 'global', 'CLAUDE.md'), 'utf8')).toBe('hello')
    expect(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8')).toBe('{"k":1}')
    expect(readFileSync(join(repoPath, 'global', 'commands', 'a.md'), 'utf8')).toBe('A')
    expect(readFileSync(join(repoPath, 'global', 'skills', 's', 'SKILL.md'), 'utf8')).toBe('S')
  })

  it('mirrors only memory subdir under projects/', () => {
    mkdirSync(join(claudePath, 'projects', 'p1', 'memory'), { recursive: true })
    mkdirSync(join(claudePath, 'projects', 'p1', 'sessions'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'p1', 'memory', 'note.md'), 'M')
    writeFileSync(join(claudePath, 'projects', 'p1', 'sessions', 's.jsonl'), 'X')

    exportClaude(claudePath, repoPath)

    expect(existsSync(join(repoPath, 'global', 'projects', 'p1', 'memory', 'note.md'))).toBe(true)
    expect(existsSync(join(repoPath, 'global', 'projects', 'p1', 'sessions'))).toBe(false)
  })
})

describe('generateClaudeStructure', () => {
  it('strips env from settings.json on first commit', () => {
    writeFileSync(join(claudePath, 'settings.json'), JSON.stringify({ env: { SECRET: 'x' }, theme: 'dark' }))

    generateClaudeStructure(claudePath, repoPath)

    const written = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(written.env).toBeUndefined()
    expect(written.theme).toBe('dark')
  })
})

describe('stripSecretsInClaudeRepo', () => {
  it('removes env block from <repo>/global/settings.json', () => {
    mkdirSync(join(repoPath, 'global'), { recursive: true })
    writeFileSync(join(repoPath, 'global', 'settings.json'), JSON.stringify({ env: { S: 'x' }, k: 1 }))

    stripSecretsInClaudeRepo(repoPath)

    const written = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(written.env).toBeUndefined()
    expect(written.k).toBe(1)
  })
})
```

- [ ] **Step 2.5: Run tests to verify they pass (post-extraction)**

```bash
npx vitest run tests/main/sync-claude.test.ts tests/main/push.test.ts tests/main/init-wizard.test.ts
```

Expected: all green. If `tests/main/push.test.ts` references the old `exportRulesToRepo` symbol or `detectInstallMode`, update those references to the new names. If `tests/main/init-wizard.test.ts` references `generateGlobalStructure` or `rulesTarget` in `InitRepoOpts`, update to `generateClaudeStructure` and `claude: { enabled: true, path: '...' }`.

- [ ] **Step 2.6: Run typecheck and full test**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: no type errors, all tests green.

- [ ] **Step 2.7: Commit**

```bash
git add src/main/sync/ src/main/push.ts src/main/init-wizard.ts tests/main/sync-claude.test.ts tests/main/push.test.ts tests/main/init-wizard.test.ts
git commit -m "refactor(sync): extract Claude exporter to src/main/sync/claude.ts"
```

---

## Task 3: Cursor exporter and validation

**Files:**
- Create: `src/main/sync/cursor.ts`
- Create: `src/main/sync/cursor-validation.ts`
- Create: `tests/main/sync-cursor.test.ts`
- Create: `tests/main/cursor-validation.test.ts`

- [ ] **Step 3.1: Create `src/main/sync/cursor.ts`**

```ts
import { existsSync, mkdirSync, statSync, readdirSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { CursorProject, LogLine } from '@shared/api'

const IGNORED_NAME = /\.DS_Store$|^Thumbs\.db$/i

function syncDirMirror(src: string, dst: string): void {
  if (!existsSync(src)) {
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    return
  }
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst)) {
      if (IGNORED_NAME.test(entry) || !existsSync(join(src, entry))) {
        rmSync(join(dst, entry), { recursive: true, force: true })
      }
    }
  }
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (IGNORED_NAME.test(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    const stat = statSync(s)
    if (stat.isDirectory()) syncDirMirror(s, d)
    else cpSync(s, d)
  }
}

function copyFileIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

export function exportCursorProject(project: CursorProject, repoPath: string, emit?: (l: LogLine) => void): void {
  if (!existsSync(project.path)) {
    emit?.({
      time: new Date().toTimeString().slice(0, 8),
      text: `cursor: project "${project.name}" path missing (${project.path}) — skipping`,
      level: 'info',
    })
    return
  }
  const dest = join(repoPath, 'cursor', 'projects', project.name)
  const dotCursor = join(project.path, '.cursor')
  // Skills + rules under .cursor/
  syncDirMirror(join(dotCursor, 'rules'), join(dest, 'rules'))
  syncDirMirror(join(dotCursor, 'skills'), join(dest, 'skills'))
  // Legacy single-file rules at project root
  copyFileIfExists(join(project.path, '.cursorrules'), join(dest, '.cursorrules'))
}

export function exportCursorProjects(projects: CursorProject[], repoPath: string, emit?: (l: LogLine) => void): void {
  for (const p of projects) {
    exportCursorProject(p, repoPath, emit)
  }
}
```

- [ ] **Step 3.2: Create `src/main/sync/cursor-validation.ts`**

This re-exports the validator from `config.ts` for convenience and adds dedup checks for the full project list:

```ts
import type { CursorProject, LocalizedMessage } from '@shared/api'
import { validateCursorProject } from '../config'

export type ProjectListValidation = { ok: true } | { ok: false; index: number; error: LocalizedMessage }

export function validateCursorProjects(projects: CursorProject[]): ProjectListValidation {
  const seenNames = new Set<string>()
  const seenPaths = new Set<string>()
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    const r = validateCursorProject(p)
    if (!r.ok) return { ok: false, index: i, error: r.error }
    if (seenNames.has(p.name)) {
      return { ok: false, index: i, error: { key: 'cursor.error.duplicateName', params: { name: p.name } } }
    }
    if (seenPaths.has(p.path)) {
      return { ok: false, index: i, error: { key: 'cursor.error.duplicatePath', params: { path: p.path } } }
    }
    seenNames.add(p.name)
    seenPaths.add(p.path)
  }
  return { ok: true }
}

export { validateCursorProject }
```

- [ ] **Step 3.3: Write failing tests in `tests/main/cursor-validation.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateCursorProject, validateCursorProjects } from '../../src/main/sync/cursor-validation'

let dir: string
let okPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-cv-'))
  okPath = join(dir, 'app')
  mkdirSync(okPath)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('validateCursorProject', () => {
  it('accepts valid project', () => {
    expect(validateCursorProject({ name: 'app', path: okPath }).ok).toBe(true)
  })
  it('rejects empty name', () => {
    expect(validateCursorProject({ name: '', path: okPath }).ok).toBe(false)
  })
  it('rejects names with path separators', () => {
    expect(validateCursorProject({ name: 'a/b', path: okPath }).ok).toBe(false)
    expect(validateCursorProject({ name: 'a\\b', path: okPath }).ok).toBe(false)
  })
  it('rejects reserved names', () => {
    expect(validateCursorProject({ name: '.', path: okPath }).ok).toBe(false)
    expect(validateCursorProject({ name: '..', path: okPath }).ok).toBe(false)
  })
  it('rejects names with leading/trailing whitespace', () => {
    expect(validateCursorProject({ name: ' app', path: okPath }).ok).toBe(false)
    expect(validateCursorProject({ name: 'app ', path: okPath }).ok).toBe(false)
  })
  it('rejects relative paths', () => {
    expect(validateCursorProject({ name: 'app', path: 'rel/path' }).ok).toBe(false)
  })
  it('rejects non-existent paths', () => {
    expect(validateCursorProject({ name: 'app', path: join(dir, 'missing') }).ok).toBe(false)
  })
})

describe('validateCursorProjects', () => {
  it('detects duplicate names', () => {
    const path2 = join(dir, 'b'); mkdirSync(path2)
    const r = validateCursorProjects([
      { name: 'x', path: okPath },
      { name: 'x', path: path2 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.index).toBe(1)
  })
  it('detects duplicate paths', () => {
    const r = validateCursorProjects([
      { name: 'a', path: okPath },
      { name: 'b', path: okPath },
    ])
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 3.4: Write failing tests in `tests/main/sync-cursor.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportCursorProject, exportCursorProjects } from '../../src/main/sync/cursor'

let dir: string
let projectPath: string
let repoPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-cur-'))
  projectPath = join(dir, 'app')
  repoPath = join(dir, 'repo')
  mkdirSync(projectPath, { recursive: true })
  mkdirSync(repoPath, { recursive: true })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('exportCursorProject', () => {
  it('mirrors .cursor/rules and .cursor/skills and copies .cursorrules', () => {
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'R')
    mkdirSync(join(projectPath, '.cursor', 'skills', 'sk'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'skills', 'sk', 'SKILL.md'), 'S')
    writeFileSync(join(projectPath, '.cursorrules'), 'legacy')

    exportCursorProject({ name: 'app', path: projectPath }, repoPath)

    const dest = join(repoPath, 'cursor', 'projects', 'app')
    expect(readFileSync(join(dest, 'rules', 'a.mdc'), 'utf8')).toBe('R')
    expect(readFileSync(join(dest, 'skills', 'sk', 'SKILL.md'), 'utf8')).toBe('S')
    expect(readFileSync(join(dest, '.cursorrules'), 'utf8')).toBe('legacy')
  })

  it('removes files from destination that are no longer in source on second push', () => {
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'A')
    writeFileSync(join(projectPath, '.cursor', 'rules', 'b.mdc'), 'B')
    exportCursorProject({ name: 'app', path: projectPath }, repoPath)

    rmSync(join(projectPath, '.cursor', 'rules', 'b.mdc'))
    exportCursorProject({ name: 'app', path: projectPath }, repoPath)

    const dest = join(repoPath, 'cursor', 'projects', 'app', 'rules')
    expect(existsSync(join(dest, 'a.mdc'))).toBe(true)
    expect(existsSync(join(dest, 'b.mdc'))).toBe(false)
  })

  it('skips and emits warning when project path is missing, leaves existing dest intact', () => {
    mkdirSync(join(repoPath, 'cursor', 'projects', 'gone'), { recursive: true })
    writeFileSync(join(repoPath, 'cursor', 'projects', 'gone', 'preserved.txt'), 'old')
    const lines: string[] = []

    exportCursorProject(
      { name: 'gone', path: join(dir, 'does-not-exist') },
      repoPath,
      (l) => lines.push(l.text),
    )

    expect(existsSync(join(repoPath, 'cursor', 'projects', 'gone', 'preserved.txt'))).toBe(true)
    expect(lines.some((t) => t.includes('gone'))).toBe(true)
  })
})

describe('exportCursorProjects', () => {
  it('exports each project under its own subdir', () => {
    const p1 = join(dir, 'p1'); mkdirSync(join(p1, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(p1, '.cursor', 'rules', 'r.md'), '1')
    const p2 = join(dir, 'p2'); mkdirSync(join(p2, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(p2, '.cursor', 'rules', 'r.md'), '2')

    exportCursorProjects([
      { name: 'one', path: p1 },
      { name: 'two', path: p2 },
    ], repoPath)

    expect(readFileSync(join(repoPath, 'cursor', 'projects', 'one', 'rules', 'r.md'), 'utf8')).toBe('1')
    expect(readFileSync(join(repoPath, 'cursor', 'projects', 'two', 'rules', 'r.md'), 'utf8')).toBe('2')
  })
})
```

- [ ] **Step 3.5: Run tests and verify green**

```bash
npx vitest run tests/main/cursor-validation.test.ts tests/main/sync-cursor.test.ts
```

Expected: all green.

- [ ] **Step 3.6: Run full typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.7: Commit**

```bash
git add src/main/sync/cursor.ts src/main/sync/cursor-validation.ts tests/main/sync-cursor.test.ts tests/main/cursor-validation.test.ts
git commit -m "feat(sync): add Cursor projects exporter and validation"
```

---

## Task 4: Wire Cursor exporter into push pipeline

**Files:**
- Modify: `src/main/push.ts`
- Modify: `tests/main/push.test.ts`

- [ ] **Step 4.1: Update `runPush` in `src/main/push.ts` to call Cursor exporter**

After the existing Claude export block (the one introduced in Task 2), add:

```ts
if (cfg.cursor.enabled && cfg.cursor.projects.length > 0) {
  try {
    exportCursorProjects(cfg.cursor.projects, repoPath, opts.emit)
  } catch (e) {
    opts.emitStep({ step: 'export', status: 'failed', message: { key: 'push.error.cursorExport', fallback: (e as Error).message } })
    return failResult({ key: 'push.error.cursorExport', fallback: (e as Error).message })
  }
}
```

Add the import at the top:

```ts
import { exportCursorProjects } from './sync/cursor'
```

- [ ] **Step 4.2: Add a multi-target test in `tests/main/push.test.ts`**

This is an isolation test of the export branching, not a full git push test. Add a focused test that calls only the export step (extract or wrap as needed). If the existing test file mocks the git layer and tests `runPush` end-to-end, add a test there. Otherwise, add a simpler test that calls `exportClaude` and `exportCursorProjects` together against a temp repo and verifies both subdirs exist.

```ts
it('writes both global/ and cursor/projects/ when both are enabled', () => {
  // ... set up dir with claude + cursor sources
  exportClaude(claudePath, repoPath)
  exportCursorProjects([{ name: 'app', path: cursorProjectPath }], repoPath)
  expect(existsSync(join(repoPath, 'global', 'CLAUDE.md'))).toBe(true)
  expect(existsSync(join(repoPath, 'cursor', 'projects', 'app'))).toBe(true)
})
```

If `tests/main/push.test.ts` already has a per-test scaffolding pattern, follow it; otherwise mirror `tests/main/sync-claude.test.ts`.

- [ ] **Step 4.3: Run push tests**

```bash
npx vitest run tests/main/push.test.ts
```

Expected: green.

- [ ] **Step 4.4: Add error key to i18n (placeholder for now)**

In `src/renderer/i18n/locales/en.json` and `ru.json`, add:

```json
"push.error.cursorExport": "Cursor export failed: {{fallback}}",
"push.error.nothingEnabled": "Nothing to sync — enable Claude or add a Cursor project in Settings."
```

(Russian translations: `Экспорт Cursor не удался: {{fallback}}`, `Нечего синхронизировать — включите Claude или добавьте проект Cursor в настройках.`)

- [ ] **Step 4.5: Commit**

```bash
git add src/main/push.ts tests/main/push.test.ts src/renderer/i18n/locales/en.json src/renderer/i18n/locales/ru.json
git commit -m "feat(push): branch pipeline on claude.enabled / cursor.enabled"
```

---

## Task 5: IPC handlers + preload + AppApi types

**Files:**
- Modify: `src/shared/api.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/plugins.ts`

- [ ] **Step 5.1: Update `AppApi` in `src/shared/api.ts`**

Replace the IPC surface around rules target:

```ts
// Before:
//   detectRulesTarget(): Promise<string | null>
//   suggestRulesTarget(): Promise<string>
//   scanLocalConfig(): Promise<ScanResult>
//   validateClaudeTarget(): Promise<ClaudeTargetCheck>
// After:
detectClaudePath(): Promise<string | null>
suggestClaudePath(): Promise<string>
scanClaudeConfig(): Promise<ScanResult>
validateClaudeTarget(): Promise<ClaudeTargetCheck>
pickCursorProjectPath(): Promise<string | null>
validateCursorProject(p: { name: string; path: string }): Promise<{ ok: true } | { ok: false; error: LocalizedMessage }>
```

Update `InitWizardOptions` to drop `rulesTarget`:

```ts
export type InitWizardOptions = CreateRepoOptions & {
  claude: { enabled: boolean; path: string | null }
}
```

Update `PushOptions` — no change needed (push reads cfg from disk).

- [ ] **Step 5.2: Update `src/preload/index.ts`**

Replace each binding:

```ts
detectClaudePath: (): Promise<string | null> =>
  ipcRenderer.invoke('detect-claude-path'),
suggestClaudePath: (): Promise<string> =>
  ipcRenderer.invoke('suggest-claude-path'),
scanClaudeConfig: (): Promise<ScanResult> =>
  ipcRenderer.invoke('scan-claude-config'),
validateClaudeTarget: (): Promise<ClaudeTargetCheck> =>
  ipcRenderer.invoke('validate-claude-target'),
pickCursorProjectPath: (): Promise<string | null> =>
  ipcRenderer.invoke('pick-cursor-project-path'),
validateCursorProject: (p) =>
  ipcRenderer.invoke('validate-cursor-project', p),
```

Remove `detectRulesTarget`, `suggestRulesTarget`, `scanLocalConfig` bindings.

- [ ] **Step 5.3: Update `src/main/ipc.ts` handlers**

Find each handler registration that uses old IPC channel names and rename:

- `'detect-rules-target'` → `'detect-claude-path'` (handler: `detectClaudeTarget()`)
- `'suggest-rules-target'` → `'suggest-claude-path'` (handler: returns `suggestedClaudeTargetPath()`)
- `'scan-local-config'` → `'scan-claude-config'` — handler signature changes: now reads `cfg.claude.path` instead of `cfg.rulesTarget`.

Add new handlers:

```ts
ipcMain.handle('pick-cursor-project-path', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Cursor project root',
  })
  if (r.canceled || r.filePaths.length === 0) return null
  return r.filePaths[0]
})

ipcMain.handle('validate-cursor-project', (_e, p: { name: string; path: string }) => {
  return validateCursorProject(p)
})
```

Add the import:

```ts
import { validateCursorProject } from './config'
```

(`dialog` is already imported as part of the `pick-repo-path` handler; if not, add `import { dialog } from 'electron'`.)

In the `set-config` handler, ensure validation is updated to walk `cfg.claude.path` and `cfg.cursor.projects`:

```ts
ipcMain.handle('set-config', async (_e, cfg: AppConfig): Promise<SetConfigResult> => {
  if (cfg.claude.path) {
    const r = validateClaudePath(cfg.claude.path)
    if (!r.ok) return { ok: false, error: r.error }
  }
  if (cfg.repoPath) {
    const r = validateLocalRepo(cfg.repoPath)
    if (!r.ok) return { ok: false, error: r.error }
  }
  if (cfg.repoUrl) {
    const r = validateRepoUrl(cfg.repoUrl)
    if (!r.ok) return { ok: false, error: r.error }
  }
  if (cfg.cursor.projects.length > 0) {
    const r = validateCursorProjects(cfg.cursor.projects)
    if (!r.ok) return { ok: false, error: r.error }
  }
  // Normalize paths
  const normalized: AppConfig = {
    ...cfg,
    claude: {
      enabled: cfg.claude.enabled,
      path: cfg.claude.path ? expandTilde(cfg.claude.path) : null,
    },
    cursor: {
      enabled: cfg.cursor.enabled,
      projects: cfg.cursor.projects.map((p) => ({ name: p.name, path: expandTilde(p.path) })),
    },
  }
  writeConfig(configPath, normalized)
  return { ok: true }
})
```

Add the import:

```ts
import { validateCursorProjects } from './sync/cursor-validation'
```

In the `init-repo` handler, the renderer now passes `claude` instead of `rulesTarget`:

```ts
// before:  rulesTarget: opts.rulesTarget
// after:
claude: opts.claude,
```

Drop any reference to `cfg.rulesTarget` in the file. Replace with `cfg.claude.path` (and check `cfg.claude.enabled` where appropriate). The `runSync` legacy handler (line 90 onwards in current ipc.ts, the install.sh runner) currently reads `cfg.rulesTarget` — switch it to `cfg.claude.path` and bail with an error message if `cfg.claude.path` is null OR `cfg.claude.enabled` is false.

- [ ] **Step 5.4: Update `src/main/plugins.ts`**

Find any reference to `rulesTarget` and replace with the corresponding `claude.path` semantic. The function `settingsPathFor(rulesTarget: string)` becomes `settingsPathFor(claudePath: string)` — same body. The function `validateClaudeTarget(rulesTarget: string | null)` becomes `validateClaudeTarget(claudePath: string | null)` — same body.

In `src/main/ipc.ts`, the `get-installed-plugins` and similar handlers must read `cfg.claude.path`:

```ts
ipcMain.handle('get-installed-plugins', () => {
  const cfg = readConfig(configPath)
  if (!cfg.claude.path || !cfg.claude.enabled) return { enabledIds: [], envSet: [], knownMarketplaces: [] }
  return getInstalled(settingsPathFor(cfg.claude.path))
})
```

- [ ] **Step 5.5: Update `tests/main/ipc.test.ts` if it imports renamed APIs**

Run `grep -rn rulesTarget tests src` and update any remaining references.

- [ ] **Step 5.6: Run typecheck and tests**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: green.

- [ ] **Step 5.7: Commit**

```bash
git add src/shared/api.ts src/preload/index.ts src/main/ipc.ts src/main/plugins.ts tests/
git commit -m "feat(ipc): rename rules-target IPCs to claude, add cursor IPC handlers"
```

---

## Task 6: Renderer state — useAppState

**Files:**
- Modify: `src/renderer/hooks/useAppState.ts`

- [ ] **Step 6.1: Update `AppState` shape**

Replace `rulesTarget: string | null` with two fields:

```ts
export type AppState = {
  repoPath: string | null
  repoUrl: string | null
  claude: { enabled: boolean; path: string | null }
  cursor: { enabled: boolean; projects: { name: string; path: string }[] }
  // ... rest unchanged
}
```

- [ ] **Step 6.2: Update `Action` type and reducer**

```ts
type Action =
  | { type: 'set-config'; repoPath: string | null; repoUrl: string | null; claude: AppState['claude']; cursor: AppState['cursor'] }
  // ... rest unchanged
```

In the reducer's `set-config` case:

```ts
case 'set-config':
  return { ...s, repoPath: a.repoPath, repoUrl: a.repoUrl, claude: a.claude, cursor: a.cursor }
```

In the `initial` const:

```ts
const initial: AppState = {
  repoPath: null,
  repoUrl: null,
  claude: { enabled: false, path: null },
  cursor: { enabled: false, projects: [] },
  // ... rest unchanged
}
```

In the `useEffect` that loads config:

```ts
void window.api.getConfig().then((c) => {
  dispatch({
    type: 'set-config',
    repoPath: c.repoPath,
    repoUrl: c.repoUrl,
    claude: c.claude,
    cursor: c.cursor,
  })
  dispatch({ type: 'set-dismissed-update', version: c.lastDismissedUpdate })
  // Settings auto-open: open if claude is unconfigured AND cursor has nothing
  if (!c.claude.path && c.cursor.projects.length === 0) dispatch({ type: 'open-settings' })
  void refreshSyncStatus(false).then(() => {
    if (c.repoUrl && c.repoPath) void refreshSyncStatus(true)
  })
})
```

Update the exported `setConfigState` callback:

```ts
setConfigState: (c: { repoPath: string | null; repoUrl: string | null; claude: AppState['claude']; cursor: AppState['cursor'] }) => {
  dispatch({ type: 'set-config', ...c })
  void refreshSyncStatus(true)
},
```

- [ ] **Step 6.3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: errors at all callsites that pass/read `rulesTarget` from useAppState — these are addressed in Task 7.

- [ ] **Step 6.4: Commit**

```bash
git add src/renderer/hooks/useAppState.ts
git commit -m "refactor(renderer): replace rulesTarget with claude/cursor in AppState"
```

---

## Task 7: Settings UI — split into tabs (Repository, Claude, Cursor)

**Files:**
- Create: `src/renderer/components/SettingsTabs.tsx`
- Create: `src/renderer/components/settings/RepositoryTab.tsx`
- Create: `src/renderer/components/settings/ClaudeTab.tsx`
- Create: `src/renderer/components/settings/CursorTab.tsx`
- Create: `src/renderer/components/settings/AddCursorProjectDialog.tsx`
- Modify: `src/renderer/components/Settings.tsx` — replace with thin shim
- Modify: any caller that imports `Settings` (App.tsx or similar)

The existing Settings component renders the entire Dialog. Refactor: keep Dialog as the outer shell in `SettingsTabs.tsx`, with tabs inside.

- [ ] **Step 7.1: Create `SettingsTabs.tsx`**

```tsx
import React, { useState } from 'react'
import type { GitHubAuthState, UpdateInfo, AppConfig } from '@shared/api'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { useT } from '../i18n'
import type { UpdaterKind } from '../hooks/useAppState'
import { RepositoryTab } from './settings/RepositoryTab'
import { ClaudeTab } from './settings/ClaudeTab'
import { CursorTab } from './settings/CursorTab'

type TabKey = 'repository' | 'claude' | 'cursor'

type Props = {
  open: boolean
  initial: AppConfig
  authState: GitHubAuthState | null
  updateInfo: UpdateInfo | null
  platform: NodeJS.Platform | null
  arch: NodeJS.Architecture | null
  updaterKind: UpdaterKind
  onCheckForUpdates: () => Promise<void>
  onStartUpdater: () => void
  onClose: () => void
  onSaved: (cfg: AppConfig) => void
  onSignOut: () => Promise<void>
  onSignedIn: () => void
}

export function SettingsTabs(props: Props) {
  const t = useT()
  const [tab, setTab] = useState<TabKey>('repository')
  const [draft, setDraft] = useState<AppConfig>(props.initial)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const r = await window.api.setConfig(draft)
      if (!r.ok) return  // child tab renders errors
      props.onSaved(draft)
      props.onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o) props.onClose() }}>
      <DialogContent className="sm:max-w-[640px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex border-b">
          {(['repository', 'claude', 'cursor'] as TabKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm transition border-b-2 ${
                tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`settings.tabs.${k}`)}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {tab === 'repository' && (
            <RepositoryTab
              draft={draft} setDraft={setDraft}
              authState={props.authState} updateInfo={props.updateInfo}
              platform={props.platform} arch={props.arch} updaterKind={props.updaterKind}
              onCheckForUpdates={props.onCheckForUpdates} onStartUpdater={props.onStartUpdater}
              onSignOut={props.onSignOut} onSignedIn={props.onSignedIn}
            />
          )}
          {tab === 'claude' && <ClaudeTab draft={draft} setDraft={setDraft} />}
          {tab === 'cursor' && <CursorTab draft={draft} setDraft={setDraft} />}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={busy}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 7.2: Create `settings/RepositoryTab.tsx`**

Move the repo URL field, advanced (local repo path), GitHub auth Section, language Section, and updates Section out of `Settings.tsx`. Strip down to a controlled component reading/writing `draft.repoUrl`, `draft.repoPath`, `draft.locale`, etc., and rendering the GitHub auth + language + updates sections (move the existing JSX as-is).

Skeleton:

```tsx
import React from 'react'
import type { AppConfig, GitHubAuthState, UpdateInfo } from '@shared/api'
import type { UpdaterKind } from '../../hooks/useAppState'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { useT, useLocale, SUPPORTED } from '../../i18n'
// ... reuse Field, Section, UpdatesPanel from existing Settings.tsx (move them or re-export)

type Props = {
  draft: AppConfig
  setDraft: React.Dispatch<React.SetStateAction<AppConfig>>
  authState: GitHubAuthState | null
  updateInfo: UpdateInfo | null
  platform: NodeJS.Platform | null
  arch: NodeJS.Architecture | null
  updaterKind: UpdaterKind
  onCheckForUpdates: () => Promise<void>
  onStartUpdater: () => void
  onSignOut: () => Promise<void>
  onSignedIn: () => void
}

export function RepositoryTab({ draft, setDraft, ...rest }: Props) {
  const t = useT()
  // ... move repo URL Field, advanced section (local repo), GitHub Section, Language Section, Updates Section here
  // Each Field uses draft.* and setDraft to update
  return (<div className="space-y-4">{/* JSX */}</div>)
}
```

To avoid duplicating `Field`, `Section`, `UpdatesPanel`, and `formatRelative`, move them to `src/renderer/components/settings/_shared.tsx` and re-import from both `RepositoryTab` and the old Settings shim.

- [ ] **Step 7.3: Create `settings/ClaudeTab.tsx`**

```tsx
import React, { useEffect, useState } from 'react'
import type { AppConfig } from '@shared/api'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { useT } from '../../i18n'
import { Field } from './_shared'

type Props = {
  draft: AppConfig
  setDraft: React.Dispatch<React.SetStateAction<AppConfig>>
}

export function ClaudeTab({ draft, setDraft }: Props) {
  const t = useT()
  const [placeholder, setPlaceholder] = useState('')

  useEffect(() => {
    void window.api.suggestClaudePath().then(setPlaceholder)
    if (!draft.claude.path) {
      void window.api.detectClaudePath().then((p) => {
        if (p) setDraft((d) => ({ ...d, claude: { ...d.claude, path: p } }))
      })
    }
  }, [])

  const browse = async () => {
    const p = await window.api.pickRepoPath()
    if (p) setDraft((d) => ({ ...d, claude: { ...d.claude, path: p } }))
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.claude.enabled}
          onChange={(e) => setDraft((d) => ({ ...d, claude: { ...d.claude, enabled: e.target.checked } }))}
          className="accent-primary"
        />
        {t('settings.claude.enable')}
      </label>

      <Field label={t('settings.claude.path.label')} hint={t('settings.claude.path.hint')}>
        <div className="flex gap-2">
          <Input
            value={draft.claude.path ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, claude: { ...d.claude, path: e.target.value || null } }))}
            placeholder={placeholder || t('settings.claude.path.placeholder')}
            className="font-mono"
            disabled={!draft.claude.enabled}
          />
          <Button type="button" variant="outline" onClick={browse} disabled={!draft.claude.enabled}>
            {t('settings.browse')}
          </Button>
        </div>
      </Field>
    </div>
  )
}
```

- [ ] **Step 7.4: Create `settings/AddCursorProjectDialog.tsx`**

```tsx
import React, { useState } from 'react'
import type { LocalizedMessage } from '@shared/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { useT, tMessage } from '../../i18n'

type Props = {
  open: boolean
  onClose: () => void
  onAdd: (p: { name: string; path: string }) => void
}

export function AddCursorProjectDialog({ open, onClose, onAdd }: Props) {
  const t = useT()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [busy, setBusy] = useState(false)

  const browse = async () => {
    const p = await window.api.pickCursorProjectPath()
    if (p) {
      setPath(p)
      if (!name.trim()) {
        // suggest name from path basename
        const parts = p.split(/[\\/]/).filter(Boolean)
        setName(parts[parts.length - 1] ?? '')
      }
    }
  }

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await window.api.validateCursorProject({ name: name.trim(), path: path.trim() })
      if (!r.ok) { setError(r.error); return }
      onAdd({ name: name.trim(), path: path.trim() })
      setName(''); setPath(''); onClose()
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('settings.cursor.add.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('settings.cursor.add.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="myapp" />
          </div>
          <div className="space-y-1.5">
            <Label>{t('settings.cursor.add.path')}</Label>
            <div className="flex gap-2">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/project" className="font-mono" />
              <Button type="button" variant="outline" onClick={browse}>{t('settings.browse')}</Button>
            </div>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {tMessage(t, error)}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !path.trim()}>{t('settings.cursor.add.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 7.5: Create `settings/CursorTab.tsx`**

```tsx
import React, { useState } from 'react'
import type { AppConfig, CursorProject } from '@shared/api'
import { Button } from '../ui/button'
import { useT } from '../../i18n'
import { AddCursorProjectDialog } from './AddCursorProjectDialog'

type Props = {
  draft: AppConfig
  setDraft: React.Dispatch<React.SetStateAction<AppConfig>>
}

export function CursorTab({ draft, setDraft }: Props) {
  const t = useT()
  const [addOpen, setAddOpen] = useState(false)

  const removeAt = (i: number) => {
    setDraft((d) => ({ ...d, cursor: { ...d.cursor, projects: d.cursor.projects.filter((_, idx) => idx !== i) } }))
  }
  const addProject = (p: CursorProject) => {
    setDraft((d) => ({ ...d, cursor: { ...d.cursor, projects: [...d.cursor.projects, p] } }))
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.cursor.enabled}
          onChange={(e) => setDraft((d) => ({ ...d, cursor: { ...d.cursor, enabled: e.target.checked } }))}
          className="accent-primary"
        />
        {t('settings.cursor.enable')}
      </label>

      <div className={draft.cursor.enabled ? '' : 'opacity-50 pointer-events-none'}>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {t('settings.cursor.projectsHeading')}
        </div>
        {draft.cursor.projects.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {t('settings.cursor.empty')}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {draft.cursor.projects.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="font-mono text-xs text-muted-foreground truncate flex-1">{p.path}</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t('settings.cursor.remove')}
                >×</button>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
          + {t('settings.cursor.addProject')}
        </Button>
      </div>

      <AddCursorProjectDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={addProject} />
    </div>
  )
}
```

- [ ] **Step 7.6: Replace `src/renderer/components/Settings.tsx` with a shim**

```tsx
export { SettingsTabs as Settings } from './SettingsTabs'
```

(Keeps existing imports of `Settings` working.)

- [ ] **Step 7.7: Update Settings caller (App.tsx or similar)**

Find the consumer that passes `initial: { repoUrl, repoPath, rulesTarget }` and `onSaved: (cfg) => ...`. Update the prop names to pass the full `AppConfig` object as `initial` and to receive the new shape on save. Search: `grep -rn "Settings " src/renderer/`.

The component is rendered in `src/renderer/App.tsx` (or similar). Update the props passed:

```tsx
<Settings
  open={state.settingsOpen}
  initial={{
    repoUrl: state.repoUrl,
    repoPath: state.repoPath,
    claude: state.claude,
    cursor: state.cursor,
    includeSecretsInPush: false,
    locale: localePreference,
    lastDismissedUpdate: state.lastDismissedUpdate,
  }}
  ...
  onSaved={(cfg) => setConfigState({ repoPath: cfg.repoPath, repoUrl: cfg.repoUrl, claude: cfg.claude, cursor: cfg.cursor })}
/>
```

- [ ] **Step 7.8: Run typecheck and full test**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: green.

- [ ] **Step 7.9: Add i18n strings to `en.json` and `ru.json`**

```json
"settings.tabs.repository": "Repository",
"settings.tabs.claude": "Claude",
"settings.tabs.cursor": "Cursor",

"settings.claude.enable": "Sync Claude Code",
"settings.claude.path.label": "Claude config folder",
"settings.claude.path.hint": "Usually ~/.claude",
"settings.claude.path.placeholder": "/Users/you/.claude",

"settings.cursor.enable": "Sync Cursor projects",
"settings.cursor.projectsHeading": "Registered projects",
"settings.cursor.empty": "No Cursor projects registered. Add one to start syncing its rules and skills.",
"settings.cursor.addProject": "Add project",
"settings.cursor.remove": "Remove",

"settings.cursor.add.title": "Add Cursor project",
"settings.cursor.add.name": "Name (used as repo subfolder)",
"settings.cursor.add.path": "Project root path",
"settings.cursor.add.submit": "Add",

"cursor.error.nameRequired": "Name is required",
"cursor.error.nameReserved": "Name cannot be \".\" or \"..\"",
"cursor.error.nameInvalid": "Name contains invalid characters or whitespace",
"cursor.error.pathRequired": "Path is required",
"cursor.error.pathAbsolute": "Path must be absolute",
"cursor.error.pathMissing": "Path does not exist",
"cursor.error.pathNotDir": "Path is not a directory",
"cursor.error.pathStat": "Cannot read path: {{fallback}}",
"cursor.error.duplicateName": "A project named \"{{name}}\" is already registered",
"cursor.error.duplicatePath": "This path is already registered: {{path}}"
```

Russian translations:

```json
"settings.tabs.repository": "Репозиторий",
"settings.tabs.claude": "Claude",
"settings.tabs.cursor": "Cursor",

"settings.claude.enable": "Синхронизировать Claude Code",
"settings.claude.path.label": "Папка конфига Claude",
"settings.claude.path.hint": "Обычно ~/.claude",
"settings.claude.path.placeholder": "/Users/you/.claude",

"settings.cursor.enable": "Синхронизировать проекты Cursor",
"settings.cursor.projectsHeading": "Зарегистрированные проекты",
"settings.cursor.empty": "Нет зарегистрированных проектов Cursor. Добавьте проект, чтобы синхронизировать его правила и навыки.",
"settings.cursor.addProject": "Добавить проект",
"settings.cursor.remove": "Удалить",

"settings.cursor.add.title": "Добавить проект Cursor",
"settings.cursor.add.name": "Имя (используется как имя папки в репо)",
"settings.cursor.add.path": "Путь к корню проекта",
"settings.cursor.add.submit": "Добавить",

"cursor.error.nameRequired": "Имя обязательно",
"cursor.error.nameReserved": "Имя не может быть \".\" или \"..\"",
"cursor.error.nameInvalid": "Имя содержит недопустимые символы или пробелы",
"cursor.error.pathRequired": "Путь обязателен",
"cursor.error.pathAbsolute": "Путь должен быть абсолютным",
"cursor.error.pathMissing": "Путь не существует",
"cursor.error.pathNotDir": "Путь не является папкой",
"cursor.error.pathStat": "Не удаётся прочитать путь: {{fallback}}",
"cursor.error.duplicateName": "Проект с именем \"{{name}}\" уже зарегистрирован",
"cursor.error.duplicatePath": "Этот путь уже зарегистрирован: {{path}}"
```

- [ ] **Step 7.10: Commit**

```bash
git add src/renderer/components/ src/renderer/i18n/locales/en.json src/renderer/i18n/locales/ru.json
git commit -m "feat(ui): split Settings into Repository/Claude/Cursor tabs"
```

---

## Task 8: Init wizard — drop rulesTarget, add target-selection step

**Files:**
- Modify: `src/renderer/components/InitWizard.tsx`
- Modify: `src/main/init-wizard.ts` (already touched in Task 2 — finalize)
- Modify: `tests/main/init-wizard.test.ts`

- [ ] **Step 8.1: Update `InitWizard.tsx`**

Find the existing wizard step that asks for `rulesTarget`. Replace with a target-selection screen:

```tsx
{step === 'targets' && (
  <div className="space-y-3">
    <h3 className="text-sm font-semibold">{t('initWizard.targets.title')}</h3>

    <label className="flex items-start gap-3 rounded-md border p-3">
      <input
        type="checkbox"
        checked={claudeEnabled}
        onChange={(e) => setClaudeEnabled(e.target.checked)}
        className="mt-1 accent-primary"
        disabled={!claudeDetected}
      />
      <div className="flex-1">
        <div className="font-medium">{t('initWizard.targets.claude')}</div>
        <div className="text-xs text-muted-foreground font-mono">
          {claudePath || t('initWizard.targets.notDetected')}
        </div>
      </div>
    </label>

    <label className="flex items-start gap-3 rounded-md border p-3 opacity-60">
      <input type="checkbox" disabled className="mt-1 accent-primary" />
      <div className="flex-1">
        <div className="font-medium">{t('initWizard.targets.cursor')}</div>
        <div className="text-xs text-muted-foreground">{t('initWizard.targets.cursorHint')}</div>
      </div>
    </label>
  </div>
)}
```

The wizard's local state:

```tsx
const [claudePath, setClaudePath] = useState<string | null>(null)
const [claudeDetected, setClaudeDetected] = useState(false)
const [claudeEnabled, setClaudeEnabled] = useState(false)

useEffect(() => {
  void window.api.detectClaudePath().then((p) => {
    setClaudePath(p)
    setClaudeDetected(!!p)
    setClaudeEnabled(!!p)
  })
}, [])
```

Pass into `initRepo`:

```ts
await window.api.initRepo({
  owner, name, isPrivate,
  claude: { enabled: claudeEnabled, path: claudePath },
})
```

Drop any `rulesTarget` field from the wizard form, and remove the corresponding step.

- [ ] **Step 8.2: Update `tests/main/init-wizard.test.ts`**

Find each test that constructs `InitRepoOpts` with `rulesTarget: '...'` and replace with `claude: { enabled: true, path: '...' }`. Run:

```bash
npx vitest run tests/main/init-wizard.test.ts
```

Expected: green.

- [ ] **Step 8.3: Run typecheck and full test**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: green.

- [ ] **Step 8.4: Add i18n strings**

```json
"initWizard.targets.title": "What to sync",
"initWizard.targets.claude": "Claude Code",
"initWizard.targets.cursor": "Cursor projects",
"initWizard.targets.notDetected": "(not detected)",
"initWizard.targets.cursorHint": "Configure Cursor projects in Settings after init."
```

Russian:

```json
"initWizard.targets.title": "Что синхронизировать",
"initWizard.targets.claude": "Claude Code",
"initWizard.targets.cursor": "Проекты Cursor",
"initWizard.targets.notDetected": "(не найдено)",
"initWizard.targets.cursorHint": "Настройте проекты Cursor после инициализации."
```

- [ ] **Step 8.5: Commit**

```bash
git add src/renderer/components/InitWizard.tsx src/main/init-wizard.ts tests/main/init-wizard.test.ts src/renderer/i18n/locales/
git commit -m "feat(init): replace rulesTarget step with claude/cursor target selection"
```

---

## Task 9: Verification — full test, build, manual UI smoke

- [ ] **Step 9.1: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 9.2: Lint**

```bash
npm run lint
```

Expected: zero errors. Fix any leftover warnings about unused imports (likely `rulesTarget`-related leftovers).

- [ ] **Step 9.3: Full test suite**

```bash
npx vitest run
```

Expected: all green.

- [ ] **Step 9.4: Build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 9.5: Manual UI smoke (dev server)**

```bash
npm run dev
```

Click through:
1. App opens → Settings auto-open if no claude.path on disk; verify Repository tab appears first.
2. Switch to Claude tab → toggle enabled, browse path, save. Verify config.json on disk gets `{ claude: { enabled: true, path: "..." }, ... }` and no `rulesTarget`.
3. Switch to Cursor tab → toggle enabled. Click "+ Add project". In dialog, browse to a real project root (one that has `.cursor/rules/` or `.cursorrules`). Verify name auto-suggests from basename. Submit.
4. Verify the project appears in the list. Save Settings.
5. Reload app. Verify both tabs preserve state, project list intact.
6. Trigger Push. In the log, observe both Claude export step and Cursor export step. Open the local repo in a file explorer:
   - `<repo>/global/CLAUDE.md` exists (legacy folder name preserved).
   - `<repo>/cursor/projects/<name>/.cursorrules` and/or `rules/` exist.
7. Remove a file from a project's `.cursor/rules/`. Push again. Verify the file is removed from the repo subdir (mirror semantics).
8. Remove the project from Settings. Push again. Verify the dest subdir is NOT auto-deleted (per spec) — user removes via `git rm` manually.

Document each step's outcome in plain text. If any step deviates from expected, treat it as a bug; do not claim Phase A complete.

- [ ] **Step 9.6: Migration smoke — legacy config**

In a clean tmp dir, write a 0.8.x-shaped `config.json`:

```json
{
  "repoPath": "/tmp/x",
  "repoUrl": "https://github.com/foo/bar",
  "rulesTarget": "/Users/you/.claude",
  "includeSecretsInPush": false,
  "locale": null,
  "lastDismissedUpdate": null
}
```

Point app at it (via `--user-data-dir` if supported, or replace the userData config.json). Launch app. Verify:
- Settings open without errors.
- Claude tab shows enabled=true, path=`/Users/you/.claude`.
- Cursor tab shows empty state.
- After clicking Save (no edits), the file on disk is rewritten without the `rulesTarget` key.

- [ ] **Step 9.7: Commit any verification fixes**

If Steps 9.5/9.6 surface bugs, fix them, then re-run 9.1–9.4 before committing.

```bash
git add <fixed files>
git commit -m "fix(<area>): <what was wrong>"
```

- [ ] **Step 9.8: Mark plan complete**

Edit this file's checkboxes at the bottom of each task. Final commit:

```bash
git add docs/superpowers/plans/2026-05-09-multi-target-sync-cursor-projects.md
git commit -m "docs(plan): mark Phase A complete"
```

---

## Self-Review Notes

This plan covers the spec's Architecture, Data model + migration, Repo layout (no rename), Cursor exporter, Claude exporter (refactor), UI tabs, Init wizard simplification, IPC changes, Plugin catalog scoping, Conflict resolver (unchanged), Sync status (unchanged), Cross-platform (no special code), and Testing items. Non-goals are not implemented.

Symbols used consistently across tasks: `claude.path`, `claude.enabled`, `cursor.projects`, `cursor.enabled`, `CursorProject`, `exportClaude`, `exportCursorProjects`, `validateClaudePath`, `validateCursorProject`, `validateCursorProjects`, IPC channels `detect-claude-path`, `suggest-claude-path`, `scan-claude-config`, `validate-claude-target`, `pick-cursor-project-path`, `validate-cursor-project`.
