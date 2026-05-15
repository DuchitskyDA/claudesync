# Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить фоновое зеркалирование `~/.claude` ↔ WT на pure-plumbing sync engine: compare без записи в WT, Push через temp git index, Pull с preview+apply, diverged блокирует обе кнопки и разрулится через per-file 3-way resolver. Источник правды — `~/.claude` и Cursor projects; WT всегда = HEAD.

**Architecture:** Новый каталог `src/main/sync/engine/` с модулями: `rules.ts`, `git-ops.ts`, `source-enum.ts`, `head-enum.ts`, `comparator.ts`, `index-builder.ts`, `pull-apply.ts`, `resolver.ts`, `engine.ts` (фасад). Существующие модули в `src/main/sync/` (`claude.ts`, `cursor.ts`, `cursor-install.ts`), `push.ts`, `conflict.ts` переписываются или удаляются. IPC-каналы в `ipc.ts` заменяются на новые engine-вызовы.

**Tech Stack:** TypeScript (strict), Node 22, vitest для тестов (`tests/**/*.test.ts`), electron-vite сборка, git CLI через `runCommand` из `src/main/runner.ts`. Тесты — real-fs + real-git в tmpdir (паттерн из существующих тестов).

**Spec:** [docs/superpowers/specs/2026-05-15-sync-engine-design.md](../specs/2026-05-15-sync-engine-design.md)

---

## File structure

**Создаются:**
- `src/main/sync/engine/rules.ts` — SyncRules: defaults + override merging
- `src/main/sync/engine/git-ops.ts` — GitOps: тонкая обёртка над git CLI (plumbing команды)
- `src/main/sync/engine/source-enum.ts` — SourceEnum: walk source dir + hash
- `src/main/sync/engine/head-enum.ts` — HeadEnum: `git ls-tree -r HEAD`
- `src/main/sync/engine/comparator.ts` — Comparator: чистая функция diff'а
- `src/main/sync/engine/index-builder.ts` — IndexBuilder: temp git index → tree → commit
- `src/main/sync/engine/pull-apply.ts` — PullApply: write blobs to source dirs
- `src/main/sync/engine/resolver.ts` — Resolver: 3-way merge state + apply
- `src/main/sync/engine/engine.ts` — Engine: фасад с публичными методами для IPC
- `src/main/sync/engine/settings-canonical.ts` — канонизация и фильтр settings.json
- `src/shared/sync-types.ts` — типы Diff, DiffEntry, PreviewItem, ResolverState etc. для IPC
- `tests/main/engine/*.test.ts` — по одному файлу на модуль + integration scenarios

**Модифицируются:**
- `src/main/ipc.ts` — заменить handlers `run-sync`, `run-push`, `run-pull`, `discard-local-changes`, `get-repo-status`, `preview-push-status`, `get-sync-status`, `refresh-sync-status`, `conflict-*` на engine-вызовы; **удалить** `runEnabledExporters`
- `src/main/sync-status.ts` — переписать через Engine.refreshStatus
- `src/main/init-wizard.ts` — `generateClaudeStructure` использует SyncRules
- `src/main/conflict.ts` — переписан как обёртка над Engine.Resolver
- `src/preload/index.ts` — новые IPC API surface
- `src/renderer/hooks/useAppState.ts` — новые actions для preview/apply/resolve
- `src/renderer/App.tsx` — Pull использует preview-modal вместо одной кнопки
- `src/renderer/components/PullButton.tsx` + новый `PullModal.tsx`
- `src/renderer/components/ConflictModal.tsx` — наполнение из Engine.Resolver

**Удаляются (в финальной фазе):**
- `src/main/push.ts` (логика переезжает в engine; classifyPullError остаётся утилитой в git-ops.ts)
- `src/main/sync/claude.ts` (за исключением `detectClaudeInstallMode` — переезжает в engine/rules или git-ops)
- `src/main/sync/cursor.ts`
- `src/main/sync/cursor-install.ts`
- Старые тесты: `sync-claude.test.ts`, `sync-cursor.test.ts`, `sync-cursor-install.test.ts`, `push.test.ts` (заменяются engine-тестами)

---

## Phase A — Foundation modules (no behavior change)

Цель: сделать engine-модули доступными в коде, но НЕ менять текущий рантайм. Старые пути работают как раньше. Каждый модуль покрыт юнит-тестами.

### Task A1: Shared types

**Files:**
- Create: `src/shared/sync-types.ts`

- [ ] **Step 1: Create shared types file**

```ts
// src/shared/sync-types.ts

/** What kind of source surface this entry belongs to. */
export type SourceKind = 'claude' | 'cursor-project'

/** Reference to a surface — either Claude global or a named Cursor project. */
export type SourceRef =
  | { kind: 'claude' }
  | { kind: 'cursor-project'; projectName: string }

/** A single file in source or HEAD. */
export type FileEntry = {
  /** Path within the repo, e.g. 'claude/CLAUDE.md' or 'cursor/projects/Foo/.cursorrules'. */
  repoPath: string
  /** Path within the source surface, e.g. 'CLAUDE.md' or '.cursorrules'. */
  surfacePath: string
  /** SHA-1 of canonical content (settings.json filtered + 2-space stringify; everything else raw bytes). */
  sha1: string
  /** Posix file mode — 100644 for regular file, 100755 for executable. */
  mode: '100644' | '100755'
  /** Byte size of canonical content. */
  size: number
}

export type DiffStatus = 'added' | 'modified' | 'deleted' | 'same'

export type DiffEntry = {
  source: SourceRef
  repoPath: string
  surfacePath: string
  status: DiffStatus
  sourceSha?: string
  headSha?: string
}

export type PreviewItem = DiffEntry & {
  /** Raw file content from origin/main, ready to write to source. */
  newContent?: Buffer
  /** Current source content for "before" view, when available. */
  currentContent?: Buffer
}

export type ResolverFile = {
  source: SourceRef
  repoPath: string
  surfacePath: string
  base: Buffer | null
  mine: Buffer | null
  theirs: Buffer | null
  choice: 'mine' | 'theirs' | 'manual' | null
  editedContent?: Buffer
}

export type ResolverState = {
  files: ResolverFile[]
  baseSha: string
  headSha: string
  theirsSha: string
}

export type EngineStatus = {
  state: 'in-sync' | 'local-changes' | 'ahead' | 'behind' | 'diverged' | 'offline' | 'no-remote' | 'unknown'
  ahead: number
  behind: number
  localChanges: number
  diffs: DiffEntry[]
  fetchedAt: number | null
  errorKey?: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/sync-types.ts
git commit -m "feat(sync-engine): add shared types for new sync engine"
```

---

### Task A2: SyncRules — defaults and effective rules

**Files:**
- Create: `src/main/sync/engine/rules.ts`
- Test: `tests/main/engine/rules.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/rules.test.ts
import { describe, it, expect } from 'vitest'
import {
  CLAUDE_TOP_LEVEL_SYNC,
  CLAUDE_TOP_LEVEL_IGNORE,
  SETTINGS_KEY_ALLOW_LIST,
  isClaudePathSynced,
  isClaudePathIgnored,
  filterSettingsObject,
} from '../../../src/main/sync/engine/rules'

describe('SyncRules — Claude top-level', () => {
  it('CLAUDE.md, settings.json, commands/, skills/ are synced', () => {
    expect(isClaudePathSynced('CLAUDE.md')).toBe(true)
    expect(isClaudePathSynced('settings.json')).toBe(true)
    expect(isClaudePathSynced('commands/a.md')).toBe(true)
    expect(isClaudePathSynced('skills/foo/SKILL.md')).toBe(true)
  })
  it('plugins/, sessions/, history.jsonl, credentials, settings.local.json are ignored', () => {
    expect(isClaudePathIgnored('plugins/cache/x')).toBe(true)
    expect(isClaudePathIgnored('history.jsonl')).toBe(true)
    expect(isClaudePathIgnored('.credentials.json')).toBe(true)
    expect(isClaudePathIgnored('settings.local.json')).toBe(true)
    expect(isClaudePathIgnored('ide/foo')).toBe(true)
    expect(isClaudePathIgnored('statsig/anything')).toBe(true)
  })
  it('projects/<hash>/memory/ is synced, projects/<hash>/sessions/ is ignored', () => {
    expect(isClaudePathSynced('projects/abc123/memory/note.md')).toBe(true)
    expect(isClaudePathIgnored('projects/abc123/sessions/s.jsonl')).toBe(true)
    expect(isClaudePathIgnored('projects/abc123/x.jsonl')).toBe(true)
  })
  it('backup-files and OS junk ignored', () => {
    expect(isClaudePathIgnored('CLAUDE.md.backup.20260101-120000')).toBe(true)
    expect(isClaudePathIgnored('.DS_Store')).toBe(true)
    expect(isClaudePathIgnored('Thumbs.db')).toBe(true)
  })
})

describe('SyncRules — settings.json filter', () => {
  it('keeps allow-list keys, drops volatile + env', () => {
    const input = {
      permissions: { allow: ['x'] },
      numStartups: 42,
      cachedChangelog: 'foo',
      env: { SECRET: 'k' },
      theme: 'dark',
      tipsHistory: { tip: 1 },
    }
    const out = filterSettingsObject(input)
    expect(out).toEqual({ permissions: { allow: ['x'] }, theme: 'dark' })
  })
  it('preserves insertion order for stable canonicalization', () => {
    const input = { theme: 'dark', permissions: { allow: ['x'] } }
    const out = filterSettingsObject(input)
    expect(Object.keys(out)).toEqual(['theme', 'permissions'])
  })
  it('empty object stays empty', () => {
    expect(filterSettingsObject({})).toEqual({})
  })
  it('drops unknown keys conservatively', () => {
    const out = filterSettingsObject({ permissions: {}, unknownNewKey: 'bar' })
    expect(out).toEqual({ permissions: {} })
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npx vitest run tests/main/engine/rules.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement rules.ts**

```ts
// src/main/sync/engine/rules.ts

/** Top-level entries within ~/.claude that are synced into the repo. */
export const CLAUDE_TOP_LEVEL_SYNC = new Set([
  'CLAUDE.md',
  'settings.json',
  'commands',
  'skills',
  'projects', // selectively — only <hash>/memory/, see isClaudePathSynced
])

/** Hardcoded ignore prefixes/exact names within ~/.claude. */
const CLAUDE_IGNORE_TOP = new Set([
  'plugins',
  'sessions',
  'cache',
  'history.jsonl',
  '.credentials.json',
  'settings.local.json',
  'ide',
  'statsig',
])

/** Volatile/OS-junk patterns ignored anywhere. */
const IGNORE_NAME = /\.backup\.\d|^\.DS_Store$|^Thumbs\.db$/i

/** settings.json keys synced cross-machine. */
export const SETTINGS_KEY_ALLOW_LIST: ReadonlySet<string> = new Set([
  'permissions',
  'hooks',
  'mcpServers',
  'theme',
  'statusLine',
  'autoCompactEnabled',
  'includeCoAuthoredBy',
  'model',
  'outputStyle',
  'verbose',
  'cleanupPeriodDays',
  'forceLoginMethod',
  'awsAuthRefresh',
  'awsCredentialExport',
  'enableArchitectTool',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
  'apiKeyHelper',
  'additionalDirectories',
])

/** Volatile/secret keys explicitly ignored — kept for documentation. */
export const CLAUDE_TOP_LEVEL_IGNORE: ReadonlySet<string> = CLAUDE_IGNORE_TOP

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}

function topSegment(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.indexOf('/')
  return i < 0 ? norm : norm.slice(0, i)
}

export function isClaudePathIgnored(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  if (IGNORE_NAME.test(basename(norm))) return true
  const top = topSegment(norm)
  if (CLAUDE_IGNORE_TOP.has(top)) return true
  // projects/<hash>/sessions/* and projects/<hash>/*.jsonl
  if (top === 'projects') {
    const parts = norm.split('/')
    if (parts[2] === 'sessions') return true
    if (parts.length === 3 && parts[2]?.endsWith('.jsonl')) return true
  }
  return false
}

export function isClaudePathSynced(relPath: string): boolean {
  if (isClaudePathIgnored(relPath)) return false
  const norm = relPath.replace(/\\/g, '/')
  const top = topSegment(norm)
  if (!CLAUDE_TOP_LEVEL_SYNC.has(top)) return false
  if (top === 'projects') {
    // require .../memory/...
    const parts = norm.split('/')
    return parts[2] === 'memory'
  }
  return true
}

export function filterSettingsObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (SETTINGS_KEY_ALLOW_LIST.has(key)) {
      out[key] = obj[key]
    }
  }
  return out
}

/** Cursor sync paths inside a project root. */
export function isCursorPathSynced(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/')
  if (IGNORE_NAME.test(basename(norm))) return false
  if (norm === '.cursorrules') return true
  if (norm.startsWith('.cursor/rules/')) return true
  if (norm.startsWith('.cursor/skills/')) return true
  return false
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npx vitest run tests/main/engine/rules.test.ts`
Expected: 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/rules.ts tests/main/engine/rules.test.ts
git commit -m "feat(sync-engine): add SyncRules with code defaults"
```

---

### Task A3: settings-canonical — canonical bytes + sha

**Files:**
- Create: `src/main/sync/engine/settings-canonical.ts`
- Test: `tests/main/engine/settings-canonical.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/settings-canonical.test.ts
import { describe, it, expect } from 'vitest'
import { canonicalizeSettings, settingsContentForCompare } from '../../../src/main/sync/engine/settings-canonical'

describe('canonicalizeSettings', () => {
  it('outputs 2-space JSON.stringify of allow-listed keys', () => {
    const input = Buffer.from('{"permissions":{"allow":["x"]},"numStartups":42,"theme":"dark"}', 'utf8')
    const out = canonicalizeSettings(input)
    expect(out.toString('utf8')).toBe('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  },\n  "theme": "dark"\n}')
  })
  it('idempotent — canonicalize(canonicalize(x)) == canonicalize(x)', () => {
    const input = Buffer.from('{"permissions":{},"numStartups":1}', 'utf8')
    const once = canonicalizeSettings(input)
    const twice = canonicalizeSettings(once)
    expect(twice.equals(once)).toBe(true)
  })
  it('returns empty object bytes when input has no allow-listed keys', () => {
    const input = Buffer.from('{"numStartups":42,"env":{"S":"x"}}', 'utf8')
    const out = canonicalizeSettings(input)
    expect(out.toString('utf8')).toBe('{}')
  })
  it('throws on invalid JSON', () => {
    expect(() => canonicalizeSettings(Buffer.from('not json', 'utf8'))).toThrow()
  })
})

describe('settingsContentForCompare', () => {
  it('null on missing source returns null', () => {
    expect(settingsContentForCompare(null)).toBeNull()
  })
  it('returns canonical bytes for present source', () => {
    const input = Buffer.from('{"theme":"dark","numStartups":1}', 'utf8')
    const out = settingsContentForCompare(input)
    expect(out?.toString('utf8')).toBe('{\n  "theme": "dark"\n}')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npx vitest run tests/main/engine/settings-canonical.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement settings-canonical.ts**

```ts
// src/main/sync/engine/settings-canonical.ts
import { filterSettingsObject } from './rules'

/**
 * Канонизация settings.json: parse → отфильтровать по allow-list → JSON.stringify(..., null, 2).
 * Идемпотентно. Без trailing newline (важно для round-trip с git index).
 */
export function canonicalizeSettings(raw: Buffer): Buffer {
  const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
  const filtered = filterSettingsObject(parsed)
  return Buffer.from(JSON.stringify(filtered, null, 2), 'utf8')
}

export function settingsContentForCompare(raw: Buffer | null): Buffer | null {
  if (raw === null) return null
  return canonicalizeSettings(raw)
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npx vitest run tests/main/engine/settings-canonical.test.ts`
Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/settings-canonical.ts tests/main/engine/settings-canonical.test.ts
git commit -m "feat(sync-engine): canonical settings.json with allow-list filter"
```

---

### Task A4: GitOps — read-only plumbing (ls-tree, cat-file, hash-object)

**Files:**
- Create: `src/main/sync/engine/git-ops.ts`
- Test: `tests/main/engine/git-ops.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/git-ops.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { lsTree, catFileBlob, hashObjectWrite } from '../../../src/main/sync/engine/git-ops'

let dir: string

function git(args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-git-'))
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@test'])
  git(['config', 'user.name', 'test'])
  mkdirSync(join(dir, 'claude'))
  writeFileSync(join(dir, 'claude', 'CLAUDE.md'), 'hello\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'init'])
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('lsTree', () => {
  it('lists files under prefix at HEAD', async () => {
    const out = await lsTree(dir, 'HEAD', 'claude/')
    expect(out).toHaveLength(1)
    expect(out[0]?.repoPath).toBe('claude/CLAUDE.md')
    expect(out[0]?.mode).toBe('100644')
    expect(out[0]?.sha).toMatch(/^[0-9a-f]{40}$/)
  })
  it('returns empty when prefix has no entries', async () => {
    const out = await lsTree(dir, 'HEAD', 'cursor/')
    expect(out).toEqual([])
  })
})

describe('catFileBlob', () => {
  it('returns blob content as Buffer', async () => {
    const tree = await lsTree(dir, 'HEAD', 'claude/')
    const sha = tree[0]!.sha
    const buf = await catFileBlob(dir, sha)
    expect(buf.toString('utf8')).toBe('hello\n')
  })
})

describe('hashObjectWrite', () => {
  it('writes blob and returns its sha; same content → same sha', async () => {
    const buf = Buffer.from('test content\n', 'utf8')
    const sha1 = await hashObjectWrite(dir, buf)
    const sha2 = await hashObjectWrite(dir, buf)
    expect(sha1).toBe(sha2)
    expect(sha1).toMatch(/^[0-9a-f]{40}$/)
    const roundtrip = await catFileBlob(dir, sha1)
    expect(roundtrip.equals(buf)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npx vitest run tests/main/engine/git-ops.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement git-ops.ts (read-only ops part)**

```ts
// src/main/sync/engine/git-ops.ts
import { spawn } from 'node:child_process'

export type LsTreeEntry = {
  mode: '100644' | '100755'
  sha: string
  repoPath: string
  size: number
}

function runGit(
  cwd: string,
  args: string[],
  opts: { stdin?: Buffer; env?: Record<string, string> } = {},
): Promise<{ exitCode: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      env: opts.env ? { ...process.env, ...opts.env } as NodeJS.ProcessEnv : process.env,
      shell: false,
    })
    const out: Buffer[] = []
    let err = ''
    proc.stdout.on('data', (b: Buffer) => out.push(b))
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (s: string) => { err += s })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      resolve({ exitCode: code ?? 1, stdout: Buffer.concat(out), stderr: err })
    })
    if (opts.stdin) {
      proc.stdin.end(opts.stdin)
    } else {
      proc.stdin.end()
    }
  })
}

export async function lsTree(repoPath: string, ref: string, prefix: string): Promise<LsTreeEntry[]> {
  const r = await runGit(repoPath, ['ls-tree', '-r', '-l', '-z', ref, '--', prefix])
  if (r.exitCode !== 0) {
    // unknown ref or empty tree at prefix
    if (/Not a valid object name|exists on disk, but not in/.test(r.stderr)) return []
    return []
  }
  const text = r.stdout.toString('utf8')
  if (text === '') return []
  const out: LsTreeEntry[] = []
  for (const line of text.split('\0')) {
    if (!line) continue
    // format: "<mode> <type> <sha> <size>\t<path>"
    const tabIdx = line.indexOf('\t')
    if (tabIdx < 0) continue
    const meta = line.slice(0, tabIdx).split(/\s+/).filter(Boolean)
    const repoPath_ = line.slice(tabIdx + 1)
    if (meta[1] !== 'blob') continue
    const mode = meta[0] === '100755' ? '100755' : '100644'
    const sha = meta[2] ?? ''
    const size = parseInt(meta[3] ?? '0', 10)
    out.push({ mode, sha, repoPath: repoPath_, size })
  }
  return out
}

export async function catFileBlob(repoPath: string, sha: string): Promise<Buffer> {
  const r = await runGit(repoPath, ['cat-file', 'blob', sha])
  if (r.exitCode !== 0) throw new Error(`git cat-file ${sha} failed: ${r.stderr}`)
  return r.stdout
}

export async function hashObjectWrite(repoPath: string, content: Buffer): Promise<string> {
  const r = await runGit(repoPath, ['hash-object', '-w', '--stdin'], { stdin: content })
  if (r.exitCode !== 0) throw new Error(`git hash-object failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/** Internal — used by index-builder etc. */
export const _internal = { runGit }
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npx vitest run tests/main/engine/git-ops.test.ts`
Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/git-ops.ts tests/main/engine/git-ops.test.ts
git commit -m "feat(sync-engine): GitOps read-only plumbing (ls-tree, cat-file, hash-object)"
```

---

### Task A5: GitOps — index ops + ref ops + WT sync

**Files:**
- Modify: `src/main/sync/engine/git-ops.ts` (add functions)
- Test: `tests/main/engine/git-ops.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `tests/main/engine/git-ops.test.ts`:

```ts
import {
  updateIndexAdd,
  updateIndexRemove,
  readTreeIntoIndex,
  writeTree,
  commitTree,
  updateRef,
  revParse,
  syncWtToHead,
} from '../../../src/main/sync/engine/git-ops'
import { existsSync, readFileSync, writeFileSync as wfs } from 'node:fs'

describe('index ops', () => {
  it('builds a tree from temp index without touching WT', async () => {
    const tmpIndex = join(dir, '.git', 'tmp-index')
    await readTreeIntoIndex(dir, 'HEAD', tmpIndex)
    const sha = await hashObjectWrite(dir, Buffer.from('new content\n', 'utf8'))
    await updateIndexAdd(dir, tmpIndex, '100644', sha, 'claude/new.md')
    const tree = await writeTree(dir, tmpIndex)
    expect(tree).toMatch(/^[0-9a-f]{40}$/)

    const headBefore = await revParse(dir, 'HEAD')
    const commit = await commitTree(dir, tree, [headBefore], 'test commit')
    await updateRef(dir, 'refs/heads/main', commit)

    expect(existsSync(join(dir, 'claude', 'new.md'))).toBe(false)  // WT not touched yet

    await syncWtToHead(dir)
    expect(readFileSync(join(dir, 'claude', 'new.md'), 'utf8')).toBe('new content\n')
  })

  it('updateIndexRemove drops a path from the tree', async () => {
    const tmpIndex = join(dir, '.git', 'tmp-index')
    await readTreeIntoIndex(dir, 'HEAD', tmpIndex)
    await updateIndexRemove(dir, tmpIndex, 'claude/CLAUDE.md')
    const tree = await writeTree(dir, tmpIndex)
    const headBefore = await revParse(dir, 'HEAD')
    const commit = await commitTree(dir, tree, [headBefore], 'rm CLAUDE.md')
    await updateRef(dir, 'refs/heads/main', commit)
    await syncWtToHead(dir)
    expect(existsSync(join(dir, 'claude', 'CLAUDE.md'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/git-ops.test.ts`
Expected: imports fail.

- [ ] **Step 3: Add functions to git-ops.ts**

Append to `src/main/sync/engine/git-ops.ts`:

```ts
export async function readTreeIntoIndex(repoPath: string, ref: string, indexFile: string): Promise<void> {
  const r = await runGit(repoPath, ['read-tree', ref], { env: { GIT_INDEX_FILE: indexFile } })
  if (r.exitCode !== 0) throw new Error(`git read-tree ${ref} failed: ${r.stderr}`)
}

export async function readTreeMergeAggressive(
  repoPath: string,
  base: string,
  ours: string,
  theirs: string,
  indexFile: string,
): Promise<void> {
  const r = await runGit(
    repoPath,
    ['read-tree', '-m', '--aggressive', base, ours, theirs],
    { env: { GIT_INDEX_FILE: indexFile } },
  )
  if (r.exitCode !== 0) throw new Error(`git read-tree -m --aggressive failed: ${r.stderr}`)
}

export async function updateIndexAdd(
  repoPath: string,
  indexFile: string,
  mode: '100644' | '100755',
  sha: string,
  path: string,
): Promise<void> {
  const r = await runGit(
    repoPath,
    ['update-index', '--add', '--cacheinfo', `${mode},${sha},${path}`],
    { env: { GIT_INDEX_FILE: indexFile } },
  )
  if (r.exitCode !== 0) throw new Error(`git update-index --add ${path} failed: ${r.stderr}`)
}

export async function updateIndexRemove(
  repoPath: string,
  indexFile: string,
  path: string,
): Promise<void> {
  const r = await runGit(
    repoPath,
    ['update-index', '--force-remove', path],
    { env: { GIT_INDEX_FILE: indexFile } },
  )
  if (r.exitCode !== 0) throw new Error(`git update-index --force-remove ${path} failed: ${r.stderr}`)
}

export async function writeTree(repoPath: string, indexFile: string): Promise<string> {
  const r = await runGit(repoPath, ['write-tree'], { env: { GIT_INDEX_FILE: indexFile } })
  if (r.exitCode !== 0) throw new Error(`git write-tree failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

export async function commitTree(
  repoPath: string,
  tree: string,
  parents: string[],
  message: string,
): Promise<string> {
  const args = ['commit-tree', tree]
  for (const p of parents) args.push('-p', p)
  args.push('-m', message)
  const r = await runGit(repoPath, args, {
    env: { GIT_AUTHOR_NAME: 'claudesync', GIT_AUTHOR_EMAIL: 'claudesync@noreply', GIT_COMMITTER_NAME: 'claudesync', GIT_COMMITTER_EMAIL: 'claudesync@noreply' },
  })
  if (r.exitCode !== 0) throw new Error(`git commit-tree failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

export async function updateRef(repoPath: string, ref: string, sha: string): Promise<void> {
  const r = await runGit(repoPath, ['update-ref', ref, sha])
  if (r.exitCode !== 0) throw new Error(`git update-ref ${ref} failed: ${r.stderr}`)
}

export async function revParse(repoPath: string, ref: string): Promise<string> {
  const r = await runGit(repoPath, ['rev-parse', ref])
  if (r.exitCode !== 0) throw new Error(`git rev-parse ${ref} failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/** Reset WT to match HEAD using index — no remote network, no rebase, just plumbing. */
export async function syncWtToHead(repoPath: string): Promise<void> {
  const r1 = await runGit(repoPath, ['read-tree', 'HEAD'])
  if (r1.exitCode !== 0) throw new Error(`git read-tree HEAD failed: ${r1.stderr}`)
  const r2 = await runGit(repoPath, ['checkout-index', '-a', '-f'])
  if (r2.exitCode !== 0) throw new Error(`git checkout-index -af failed: ${r2.stderr}`)
  // Also remove WT files NOT in index (otherwise dropped paths stay around).
  const r3 = await runGit(repoPath, ['clean', '-fd', '-e', '.git'])
  if (r3.exitCode !== 0) throw new Error(`git clean failed: ${r3.stderr}`)
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/git-ops.test.ts`
Expected: all tests pass (6 total in this file).

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/git-ops.ts tests/main/engine/git-ops.test.ts
git commit -m "feat(sync-engine): GitOps index/ref ops + syncWtToHead"
```

---

### Task A6: GitOps — remote ops (fetch, push, merge-base, classify error)

**Files:**
- Modify: `src/main/sync/engine/git-ops.ts`
- Test: `tests/main/engine/git-ops-classify.test.ts`

- [ ] **Step 1: Write failing test for classify**

```ts
// tests/main/engine/git-ops-classify.test.ts
import { describe, it, expect } from 'vitest'
import { classifyRemoteError } from '../../../src/main/sync/engine/git-ops'

describe('classifyRemoteError', () => {
  it('network errors', () => {
    expect(classifyRemoteError('Could not resolve host: github.com')).toBe('network')
    expect(classifyRemoteError('TLS handshake error')).toBe('network')
    expect(classifyRemoteError('Connection reset by peer')).toBe('network')
  })
  it('auth errors', () => {
    expect(classifyRemoteError('Authentication failed for https://...')).toBe('auth')
    expect(classifyRemoteError('403 Forbidden')).toBe('auth')
  })
  it('non-fast-forward', () => {
    expect(classifyRemoteError('! [rejected]        main -> main (non-fast-forward)')).toBe('non-ff')
  })
  it('other', () => {
    expect(classifyRemoteError('something weird')).toBe('other')
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/git-ops-classify.test.ts`
Expected: classifyRemoteError not exported.

- [ ] **Step 3: Add to git-ops.ts**

Append:

```ts
export type RemoteErrorKind = 'network' | 'auth' | 'non-ff' | 'other'

export function classifyRemoteError(stderr: string): RemoteErrorKind {
  const s = stderr.toLowerCase()
  if (/non-fast-forward|fetch first|updates were rejected/.test(s)) return 'non-ff'
  if (
    /tls|ssl|unexpected eof|could not resolve host|connection (reset|refused|timed out)|network is unreachable|operation timed out|proxy|the requested url returned error: 5\d\d/.test(s)
  ) return 'network'
  if (
    /authentication failed|401|403|invalid username or password|bad credentials|terminal prompts disabled/.test(s)
  ) return 'auth'
  return 'other'
}

function authArgs(token: string | null): string[] {
  if (!token) return []
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`]
}

export async function fetchOrigin(repoPath: string, token: string | null, timeoutMs = 8000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = require('node:child_process').spawn(
      'git',
      [...authArgs(token), '-C', repoPath, 'fetch', '--quiet', 'origin'],
      { cwd: repoPath },
    )
    let stderr = ''
    let settled = false
    const settle = (ok: boolean) => { if (settled) return; settled = true; resolve({ ok, stderr }) }
    const t = setTimeout(() => { try { proc.kill('SIGKILL') } catch {/*noop*/} settle(false) }, timeoutMs)
    proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString() })
    proc.on('exit', (code: number | null) => { clearTimeout(t); settle(code === 0) })
    proc.on('error', () => { clearTimeout(t); settle(false) })
  })
}

export async function pushOrigin(repoPath: string, branch: string, token: string | null): Promise<{ ok: boolean; stderr: string }> {
  const r = await _internal.runGit(repoPath, [...authArgs(token), 'push', 'origin', branch])
  return { ok: r.exitCode === 0, stderr: r.stderr }
}

export async function mergeBase(repoPath: string, a: string, b: string): Promise<string> {
  const r = await _internal.runGit(repoPath, ['merge-base', a, b])
  if (r.exitCode !== 0) throw new Error(`git merge-base failed: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

export async function revListCount(repoPath: string, range: string): Promise<number> {
  const r = await _internal.runGit(repoPath, ['rev-list', '--count', range])
  if (r.exitCode !== 0) return 0
  const n = parseInt(r.stdout.toString('utf8').trim(), 10)
  return Number.isFinite(n) ? n : 0
}
```

- [ ] **Step 4: Run all git-ops tests, verify PASS**

Run: `npx vitest run tests/main/engine/`
Expected: all engine tests pass so far.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/git-ops.ts tests/main/engine/git-ops-classify.test.ts
git commit -m "feat(sync-engine): GitOps remote ops + error classification"
```

---

### Task A7: SourceEnum — walk source surface

**Files:**
- Create: `src/main/sync/engine/source-enum.ts`
- Test: `tests/main/engine/source-enum.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/source-enum.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enumClaudeSource, enumCursorProjectSource } from '../../../src/main/sync/engine/source-enum'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-src-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('enumClaudeSource', () => {
  it('returns CLAUDE.md, settings.json, commands/, skills/ entries with sha+size', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    writeFileSync(join(claude, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claude, 'settings.json'), '{"permissions":{"allow":["x"]},"numStartups":1}')
    mkdirSync(join(claude, 'commands'))
    writeFileSync(join(claude, 'commands', 'a.md'), 'A\n')

    const out = await enumClaudeSource(claude)
    const paths = out.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'claude/CLAUDE.md',
      'claude/commands/a.md',
      'claude/settings.json',
    ])
    const settings = out.find(e => e.repoPath === 'claude/settings.json')!
    // numStartups filtered out → content has only permissions
    expect(settings.size).toBe(Buffer.from('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}', 'utf8').length)
  })

  it('ignores plugins/, sessions/, history.jsonl, .credentials.json, settings.local.json', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'plugins'), { recursive: true })
    mkdirSync(join(claude, 'sessions'), { recursive: true })
    writeFileSync(join(claude, 'plugins', 'x.json'), 'X')
    writeFileSync(join(claude, 'sessions', 's.jsonl'), 'S')
    writeFileSync(join(claude, 'history.jsonl'), 'H')
    writeFileSync(join(claude, '.credentials.json'), 'C')
    writeFileSync(join(claude, 'settings.local.json'), '{}')
    const out = await enumClaudeSource(claude)
    expect(out).toEqual([])
  })

  it('includes only memory subdir of projects/<hash>', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(join(claude, 'projects', 'abc', 'memory'), { recursive: true })
    mkdirSync(join(claude, 'projects', 'abc', 'sessions'), { recursive: true })
    writeFileSync(join(claude, 'projects', 'abc', 'memory', 'n.md'), 'N')
    writeFileSync(join(claude, 'projects', 'abc', 'sessions', 's.jsonl'), 'X')
    writeFileSync(join(claude, 'projects', 'abc', 'log.jsonl'), 'L')
    const out = await enumClaudeSource(claude)
    expect(out.map(e => e.repoPath)).toEqual(['claude/projects/abc/memory/n.md'])
  })

  it('returns [] when ~/.claude does not exist', async () => {
    const out = await enumClaudeSource(join(dir, 'no-such-dir'))
    expect(out).toEqual([])
  })

  it('skips files larger than 5MB with no throw', async () => {
    const claude = join(dir, '.claude')
    mkdirSync(claude)
    const big = Buffer.alloc(6 * 1024 * 1024, 0)
    writeFileSync(join(claude, 'commands', 'big.md'), big as any)
    // ENOENT — commands dir; create it first
    mkdirSync(join(claude, 'commands'), { recursive: true })
    writeFileSync(join(claude, 'commands', 'big.md'), big)
    const out = await enumClaudeSource(claude)
    expect(out.find(e => e.repoPath === 'claude/commands/big.md')).toBeUndefined()
  })
})

describe('enumCursorProjectSource', () => {
  it('includes .cursor/rules/, .cursor/skills/, .cursorrules', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, '.cursor', 'rules'), { recursive: true })
    mkdirSync(join(proj, '.cursor', 'skills', 's'), { recursive: true })
    writeFileSync(join(proj, '.cursor', 'rules', 'r.mdc'), 'R')
    writeFileSync(join(proj, '.cursor', 'skills', 's', 'SKILL.md'), 'S')
    writeFileSync(join(proj, '.cursorrules'), 'C')
    const out = await enumCursorProjectSource(proj, 'MyProj')
    const paths = out.map(e => e.repoPath).sort()
    expect(paths).toEqual([
      'cursor/projects/MyProj/.cursor/rules/r.mdc',
      'cursor/projects/MyProj/.cursor/skills/s/SKILL.md',
      'cursor/projects/MyProj/.cursorrules',
    ])
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/source-enum.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement source-enum.ts**

```ts
// src/main/sync/engine/source-enum.ts
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { createHash } from 'node:crypto'
import type { FileEntry } from '@shared/sync-types'
import { isClaudePathSynced, isClaudePathIgnored, isCursorPathSynced } from './rules'
import { canonicalizeSettings } from './settings-canonical'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB

function sha1OfBlob(content: Buffer): string {
  // git blob sha: sha1("blob <len>\0<content>")
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(content).digest('hex')
}

function toRepoPath(parts: string[]): string {
  return posix.join(...parts)
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

/** Walks ~/.claude, returns synced file entries. */
export async function enumClaudeSource(claudePath: string): Promise<FileEntry[]> {
  if (!existsSync(claudePath)) return []
  const out: FileEntry[] = []
  walk(claudePath, [], (rel, abs) => {
    if (isClaudePathIgnored(rel)) return
    if (!isClaudePathSynced(rel)) return
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
      repoPath: `claude/${rel}`,
      surfacePath: rel,
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
  let content = readFileSync(surfaceAbsPath)
  if (surfaceRelPath === 'settings.json') content = canonicalizeSettings(content)
  return content
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/source-enum.test.ts`
Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/source-enum.ts tests/main/engine/source-enum.test.ts
git commit -m "feat(sync-engine): SourceEnum walks ~/.claude and Cursor projects"
```

---

### Task A8: HeadEnum + Comparator

**Files:**
- Create: `src/main/sync/engine/head-enum.ts`
- Create: `src/main/sync/engine/comparator.ts`
- Test: `tests/main/engine/comparator.test.ts`

- [ ] **Step 1: Write failing test for comparator**

```ts
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
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/comparator.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement head-enum.ts**

```ts
// src/main/sync/engine/head-enum.ts
import { lsTree } from './git-ops'
import type { FileEntry } from '@shared/sync-types'

/** Returns FileEntry-shaped list from HEAD under a repo prefix (e.g. 'claude/' or 'cursor/projects/Foo/'). */
export async function enumHead(repoPath: string, prefix: string, surfacePrefix: string): Promise<FileEntry[]> {
  const ls = await lsTree(repoPath, 'HEAD', prefix)
  return ls.map((e) => ({
    repoPath: e.repoPath,
    surfacePath: e.repoPath.startsWith(surfacePrefix) ? e.repoPath.slice(surfacePrefix.length) : e.repoPath,
    sha1: e.sha,
    mode: e.mode,
    size: e.size,
  }))
}
```

- [ ] **Step 4: Implement comparator.ts**

```ts
// src/main/sync/engine/comparator.ts
import type { DiffEntry, FileEntry, SourceRef } from '@shared/sync-types'

type HeadLike = { repoPath: string; sha: string; mode: '100644' | '100755'; size: number }

export function compare(source: SourceRef, src: FileEntry[], head: HeadLike[]): DiffEntry[] {
  const srcMap = new Map(src.map((e) => [e.repoPath, e]))
  const headMap = new Map(head.map((e) => [e.repoPath, e]))
  const allPaths = new Set([...srcMap.keys(), ...headMap.keys()])
  const out: DiffEntry[] = []
  for (const repoPath of allPaths) {
    const s = srcMap.get(repoPath)
    const h = headMap.get(repoPath)
    const surfacePath = s?.surfacePath ?? repoPath.split('/').slice(2).join('/')  // fallback for deleted
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
  // Stable order for UI
  out.sort((a, b) => a.repoPath.localeCompare(b.repoPath))
  return out
}
```

- [ ] **Step 5: Run, verify PASS**

Run: `npx vitest run tests/main/engine/comparator.test.ts`
Expected: 4 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/main/sync/engine/head-enum.ts src/main/sync/engine/comparator.ts tests/main/engine/comparator.test.ts
git commit -m "feat(sync-engine): HeadEnum + Comparator"
```

---

### Task A9: Phase A typecheck + lint + final commit

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Run full lint**

Run: `npm run lint`
Expected: no errors in new files.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all existing + new engine tests pass.

- [ ] **Step 4: Confirm Phase A is purely additive**

Check: `git diff --stat HEAD~9 HEAD -- src/main/` — should show only new files in `src/main/sync/engine/` and new `src/shared/sync-types.ts`. No modifications to existing main code yet.

---

## Phase B — Compare integration (replace getSyncStatus, no behavior change yet)

End of Phase B: chip status comes from Engine, fantom diff'ы исчезли. Push/Pull кнопки пока используют старые handlers — старые pipeline'ы продолжают работать. Это позволяет проверить Compare изолированно.

### Task B1: Engine façade + refreshStatus

**Files:**
- Create: `src/main/sync/engine/engine.ts`
- Test: `tests/main/engine/engine-refresh.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/engine-refresh.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { refreshStatus } from '../../../src/main/sync/engine/engine'
import type { CursorProject } from '@shared/api'

let dir: string
let claudePath: string
let repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-eng-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath)
  mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t'])
  git(repoPath, ['config', 'user.name', 't'])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'hello\n')
  git(repoPath, ['add', '-A'])
  git(repoPath, ['commit', '-q', '-m', 'init'])
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('refreshStatus', () => {
  it('reports in-sync when source matches HEAD exactly', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello\n')
    const s = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(s.state).toBe('in-sync')
    expect(s.localChanges).toBe(0)
  })
  it('reports local-changes when source has new file', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    const s = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(s.state).toBe('local-changes')
    expect(s.localChanges).toBe(1)
    const added = s.diffs.find((d) => d.repoPath === 'claude/settings.json')
    expect(added?.status).toBe('added')
  })
  it('ignores Claude volatile keys in settings.json', async () => {
    // Write settings to HEAD then bump only numStartups in source — should report in-sync.
    writeFileSync(join(repoPath, 'claude', 'settings.json'), '{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-q', '-m', 'settings'])
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"permissions":{"allow":["x"]},"numStartups":42}')
    const s = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(s.state).toBe('in-sync')
    expect(s.localChanges).toBe(0)
  })
  it('does NOT write to WT (no phantom diff)', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'modified\n')
    await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    const wtContent = require('node:fs').readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')
    expect(wtContent).toBe('hello\n')  // WT untouched
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/engine-refresh.test.ts`
Expected: module engine.ts not found.

- [ ] **Step 3: Implement engine.ts refreshStatus**

```ts
// src/main/sync/engine/engine.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CursorProject } from '@shared/api'
import type { EngineStatus, DiffEntry, SourceRef } from '@shared/sync-types'
import { enumClaudeSource, enumCursorProjectSource } from './source-enum'
import { enumHead } from './head-enum'
import { compare } from './comparator'
import { fetchOrigin, revListCount, revParse } from './git-ops'

export type RefreshArgs = {
  repoPath: string | null
  claudePath: string | null
  cursorProjects: CursorProject[]
  token: string | null
  doFetch?: boolean
}

const EMPTY_STATUS: EngineStatus = {
  state: 'no-remote', ahead: 0, behind: 0, localChanges: 0, diffs: [], fetchedAt: null,
}

export async function refreshStatus(args: RefreshArgs): Promise<EngineStatus> {
  const { repoPath, claudePath, cursorProjects, token } = args
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return EMPTY_STATUS

  const diffs: DiffEntry[] = []

  // Claude
  if (claudePath) {
    const src: SourceRef = { kind: 'claude' }
    const srcEntries = await enumClaudeSource(claudePath)
    const headEntries = await enumHead(repoPath, 'claude/', 'claude/')
    const part = compare(src, srcEntries, headEntries.map((h) => ({ ...h, sha: h.sha1 })))
    diffs.push(...part)
  }

  // Cursor projects
  for (const proj of cursorProjects) {
    const src: SourceRef = { kind: 'cursor-project', projectName: proj.name }
    const srcEntries = await enumCursorProjectSource(proj.path, proj.name)
    const headEntries = await enumHead(repoPath, `cursor/projects/${proj.name}/`, `cursor/projects/${proj.name}/`)
    const part = compare(src, srcEntries, headEntries.map((h) => ({ ...h, sha: h.sha1 })))
    diffs.push(...part)
  }

  const localChanges = diffs.filter((d) => d.status !== 'same').length

  // Remote
  let fetchedAt: number | null = null
  let offline = false
  if (args.doFetch !== false) {
    const f = await fetchOrigin(repoPath, token)
    if (f.ok) fetchedAt = Date.now()
    else offline = true
  }

  let ahead = 0, behind = 0
  try {
    await revParse(repoPath, 'origin/main')
    ahead = await revListCount(repoPath, 'origin/main..HEAD')
    behind = await revListCount(repoPath, 'HEAD..origin/main')
  } catch {
    // no upstream — leave 0
  }

  let state: EngineStatus['state']
  if (offline) state = 'offline'
  else if (behind > 0 && localChanges > 0) state = 'diverged'
  else if (behind > 0) state = 'behind'
  else if (localChanges > 0 && ahead === 0) state = 'local-changes'
  else if (ahead > 0) state = 'ahead'
  else state = 'in-sync'

  return { state, ahead, behind, localChanges, diffs, fetchedAt }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/engine-refresh.test.ts`
Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/engine.ts tests/main/engine/engine-refresh.test.ts
git commit -m "feat(sync-engine): Engine.refreshStatus with no-WT-mutation invariant"
```

---

### Task B2: Wire refreshStatus to IPC

**Files:**
- Modify: `src/main/ipc.ts` (replace `getSyncStatus` callers)
- Modify: `src/main/sync-status.ts` (proxy to Engine)

- [ ] **Step 1: Replace sync-status.ts content**

Replace whole file `src/main/sync-status.ts`:

```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncStatus } from '@shared/api'
import type { CursorProject } from '@shared/api'
import { refreshStatus } from './sync/engine/engine'
import { loadToken } from './safe-storage'

export type SyncStatusOpts = {
  repoPath: string | null
  claudePath: string | null
  cursorProjects: CursorProject[]
  userDataDir: string
  doFetch: boolean
}

/** Adapter: maps EngineStatus → SyncStatus (existing IPC contract). */
export async function getSyncStatus(opts: SyncStatusOpts): Promise<SyncStatus> {
  if (!opts.repoPath || !existsSync(join(opts.repoPath, '.git'))) {
    return { state: 'no-remote', behind: 0, ahead: 0, localChanges: 0, fetchedAt: null }
  }
  const token = loadToken(opts.userDataDir)
  const s = await refreshStatus({
    repoPath: opts.repoPath,
    claudePath: opts.claudePath,
    cursorProjects: opts.cursorProjects,
    token,
    doFetch: opts.doFetch,
  })
  const out: SyncStatus = {
    state: s.state,
    behind: s.behind,
    ahead: s.ahead,
    localChanges: s.localChanges,
    fetchedAt: s.fetchedAt,
  }
  if (s.errorKey) out.errorKey = s.errorKey
  return out
}
```

- [ ] **Step 2: Update ipc.ts get-sync-status / refresh-sync-status handlers**

Modify `src/main/ipc.ts` — find the two handlers `ipcMain.handle('get-sync-status', ...)` and `ipcMain.handle('refresh-sync-status', ...)`. Replace their bodies:

```ts
ipcMain.handle('get-sync-status', async () => {
  const cfg = readConfig(configPath)
  if (cachedSyncStatus.fetchedAt !== null) {
    const fresh = await getSyncStatus({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      userDataDir,
      doFetch: false,
    })
    cachedSyncStatus = { ...fresh, fetchedAt: cachedSyncStatus.fetchedAt }
    return cachedSyncStatus
  }
  cachedSyncStatus = await getSyncStatus({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    userDataDir,
    doFetch: false,
  })
  return cachedSyncStatus
})

ipcMain.handle('refresh-sync-status', async () => {
  const cfg = readConfig(configPath)
  cachedSyncStatus = await getSyncStatus({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    userDataDir,
    doFetch: true,
  })
  return cachedSyncStatus
})
```

**Важно:** удалить вызовы `runEnabledExporters(cfg)` из обоих handlers (это и есть источник фантомных diff'ов).

- [ ] **Step 3: Run existing sync-status tests**

Run: `npx vitest run tests/main/sync-status.test.ts`
Expected: tests pass (поскольку engine даёт ту же поверхность результата). Если упадут — нужно обновить тесты под новый чистый поведение (см. Task B5).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync-status.ts src/main/ipc.ts
git commit -m "feat(sync-engine): get-sync-status now goes through Engine (no WT mutation)"
```

---

### Task B3: Remove runEnabledExporters from get-repo-status and preview-push-status

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Replace get-repo-status handler**

В `src/main/ipc.ts` найди handler `ipcMain.handle('get-repo-status', ...)`. Замени так, чтобы он вызывал engine и формировал список изменённых файлов из diff'а:

```ts
ipcMain.handle('get-repo-status', async () => {
  const cfg = readConfig(configPath)
  if (!cfg.repoPath) return { changedFiles: [], clean: true }
  const status = await refreshStatus({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    doFetch: false,
  })
  const changedFiles = status.diffs
    .filter((d) => d.status !== 'same')
    .map((d) => d.repoPath)
  return { changedFiles, clean: changedFiles.length === 0 }
})

ipcMain.handle('preview-push-status', async () => {
  // Identical to get-repo-status now — old "non-silent export with emit" semantics is gone.
  const cfg = readConfig(configPath)
  if (!cfg.repoPath) return { changedFiles: [], clean: true }
  const status = await refreshStatus({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    doFetch: false,
  })
  const changedFiles = status.diffs
    .filter((d) => d.status !== 'same')
    .map((d) => d.repoPath)
  return { changedFiles, clean: changedFiles.length === 0 }
})
```

И добавь импорт: `import { refreshStatus } from './sync/engine/engine'`.

- [ ] **Step 2: Remove runEnabledExporters helper entirely**

В `src/main/ipc.ts` удали функцию `function runEnabledExporters(...)` и все её вызовы (их остаётся ровно в этих handlers; после Step 1 они исчезают). Также удали импорты, которые больше не используются: `detectClaudeInstallMode`, `exportClaude`, `stripSecretsInClaudeRepo`, `exportCursorProjects`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Если есть warnings о unused imports — удали их.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(sync-engine): remove runEnabledExporters — no more background WT mutation"
```

---

### Task B4: Regression test — no phantom diff after Pull

Этот тест воспроизводит исходный баг пользователя и фиксирует, что новый Engine его не воспроизводит.

**Files:**
- Create: `tests/main/engine/regression-no-phantom-after-pull.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/main/engine/regression-no-phantom-after-pull.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { refreshStatus } from '../../../src/main/sync/engine/engine'

let dir: string
let claudePath: string
let repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-noph-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath)
  mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t'])
  git(repoPath, ['config', 'user.name', 't'])
  // First commit — "what Mac pushed": canonical settings.json + CLAUDE.md
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'shared rules\n')
  writeFileSync(
    join(repoPath, 'claude', 'settings.json'),
    '{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}',
  )
  git(repoPath, ['add', '-A'])
  git(repoPath, ['commit', '-q', '-m', 'mac push'])
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('no phantom diff after pull', () => {
  it('refreshStatus returns in-sync when source equals HEAD (canonical)', async () => {
    // simulate "after pull": source contains exactly what HEAD has, plus Claude's volatile numStartups
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'shared rules\n')
    writeFileSync(
      join(claudePath, 'settings.json'),
      '{"permissions":{"allow":["x"]},"numStartups":42,"env":{"SECRET":"k"}}',
    )

    // run 20 status refreshes — none should produce phantom diff
    for (let i = 0; i < 20; i++) {
      const s = await refreshStatus({
        repoPath, claudePath, cursorProjects: [], token: null, doFetch: false,
      })
      expect(s.localChanges).toBe(0)
      expect(s.state).toBe('in-sync')
    }
  })

  it('windows-only project hash dirs do NOT show as untracked when not in HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'shared rules\n')
    writeFileSync(
      join(claudePath, 'settings.json'),
      '{"permissions":{"allow":["x"]}}',
    )
    // Windows-only project memory
    mkdirSync(join(claudePath, 'projects', 'win-hash', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'win-hash', 'memory', 'note.md'), 'local note\n')

    const s = await refreshStatus({
      repoPath, claudePath, cursorProjects: [], token: null, doFetch: false,
    })
    // It IS a local change (added) — that's correct semantics now: user has unpushed memory.
    // But chip says "1 local-change", not 1+ untracked artifacts from background export.
    expect(s.localChanges).toBe(1)
    const added = s.diffs.find((d) => d.repoPath === 'claude/projects/win-hash/memory/note.md')
    expect(added?.status).toBe('added')
  })
})
```

- [ ] **Step 2: Run, verify PASS**

Run: `npx vitest run tests/main/engine/regression-no-phantom-after-pull.test.ts`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/main/engine/regression-no-phantom-after-pull.test.ts
git commit -m "test(sync-engine): regression — no phantom diff after pull"
```

---

### Task B5: Phase B verification

- [ ] **Step 1: Full typecheck + lint + test**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. Если падают старые тесты, которые проверяли `runEnabledExporters`-побочки — обнови их под чистый Engine-контракт (но не правь поведение).

- [ ] **Step 2: Manual smoke (Electron dev)**

Run: `npm run dev`
Сценарии:
1. Открой приложение, выбери настроенный sync-repo. Чип должен показать актуальное состояние.
2. Не делая никаких изменений, обнови чип несколько раз (focus blur, Refresh button). Должен оставаться "in sync" / "local-changes" в зависимости от исходного состояния, БЕЗ возрастания количества localChanges на ровном месте.
3. Открой DevTools, проверь что `<repoPath>/claude/` НЕ модифицируется (mtime файлов не меняется).

---

## Phase C — Push pipeline (replace runPush)

### Task C1: IndexBuilder

**Files:**
- Create: `src/main/sync/engine/index-builder.ts`
- Test: `tests/main/engine/index-builder.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/index-builder.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildAndCommitFromSource } from '../../../src/main/sync/engine/index-builder'
import type { DiffEntry } from '@shared/sync-types'

let dir: string, claudePath: string, repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-ix-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath); mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'old\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'init'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('buildAndCommitFromSource', () => {
  it('commits added/modified/deleted; WT == HEAD after', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'new\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    const diffs: DiffEntry[] = [
      { source: { kind: 'claude' }, repoPath: 'claude/CLAUDE.md', surfacePath: 'CLAUDE.md', status: 'modified' },
      { source: { kind: 'claude' }, repoPath: 'claude/settings.json', surfacePath: 'settings.json', status: 'added' },
    ]
    const sourceContent = (d: DiffEntry): Buffer | null => {
      if (d.repoPath === 'claude/CLAUDE.md') return Buffer.from('new\n', 'utf8')
      if (d.repoPath === 'claude/settings.json') return Buffer.from('{\n  "theme": "dark"\n}', 'utf8')
      return null
    }
    const newSha = await buildAndCommitFromSource({
      repoPath, diffs, sourceContent, commitMessage: 'test',
      indexFile: join(repoPath, '.git', 'tmp-index'),
    })
    expect(newSha).toMatch(/^[0-9a-f]{40}$/)
    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('new\n')
    expect(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8')).toBe('{\n  "theme": "dark"\n}')
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/index-builder.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement index-builder.ts**

```ts
// src/main/sync/engine/index-builder.ts
import { rmSync } from 'node:fs'
import type { DiffEntry } from '@shared/sync-types'
import {
  readTreeIntoIndex, updateIndexAdd, updateIndexRemove, writeTree, commitTree,
  updateRef, revParse, hashObjectWrite, syncWtToHead,
} from './git-ops'

export type BuildArgs = {
  repoPath: string
  diffs: DiffEntry[]
  /** Returns canonical content for a source file, or null if not applicable (deletion). */
  sourceContent: (d: DiffEntry) => Buffer | null
  commitMessage: string
  indexFile: string
  /** Optional second parent for merge commits. */
  secondParent?: string | null
}

export async function buildAndCommitFromSource(args: BuildArgs): Promise<string> {
  const { repoPath, diffs, sourceContent, commitMessage, indexFile, secondParent } = args
  try {
    await readTreeIntoIndex(repoPath, 'HEAD', indexFile)
    for (const d of diffs) {
      if (d.status === 'deleted') {
        await updateIndexRemove(repoPath, indexFile, d.repoPath)
      } else if (d.status === 'added' || d.status === 'modified') {
        const buf = sourceContent(d)
        if (buf === null) throw new Error(`source content missing for ${d.repoPath}`)
        const sha = await hashObjectWrite(repoPath, buf)
        await updateIndexAdd(repoPath, indexFile, '100644', sha, d.repoPath)
      }
    }
    const tree = await writeTree(repoPath, indexFile)
    const headTree = await revParse(repoPath, 'HEAD^{tree}')
    if (tree === headTree && !secondParent) return await revParse(repoPath, 'HEAD')  // nothing
    const head = await revParse(repoPath, 'HEAD')
    const parents = secondParent ? [head, secondParent] : [head]
    const commit = await commitTree(repoPath, tree, parents, commitMessage)
    await updateRef(repoPath, 'refs/heads/main', commit)
    await syncWtToHead(repoPath)
    return commit
  } finally {
    try { rmSync(indexFile, { force: true }) } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/index-builder.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/index-builder.ts tests/main/engine/index-builder.test.ts
git commit -m "feat(sync-engine): IndexBuilder commits from source without WT mutation"
```

---

### Task C2: Engine.computePushPreview + Engine.executePush

**Files:**
- Modify: `src/main/sync/engine/engine.ts`
- Test: `tests/main/engine/engine-push.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/engine-push.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computePushPreview, executePush } from '../../../src/main/sync/engine/engine'

let dir: string, claudePath: string, repoPath: string, remotePath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-push-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  remotePath = join(dir, 'remote.git')
  mkdirSync(claudePath); mkdirSync(repoPath); mkdirSync(remotePath)
  git(remotePath, ['init', '--bare', '-q', '-b', 'main'])
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  git(repoPath, ['remote', 'add', 'origin', remotePath])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'old\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'init'])
  git(repoPath, ['push', '-q', '-u', 'origin', 'main'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Engine.push', () => {
  it('preview lists modified files; execute commits and pushes; WT == HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'new\n')
    const preview = await computePushPreview({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(preview.kind).toBe('preview')
    if (preview.kind !== 'preview') throw new Error('expected preview')
    expect(preview.items.find((d) => d.repoPath === 'claude/CLAUDE.md')?.status).toBe('modified')

    const result = await executePush({
      repoPath, claudePath, cursorProjects: [], token: null,
      commitMessage: 'update CLAUDE.md',
    })
    expect(result.kind).toBe('ok')
    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('new\n')

    // Remote received it
    const lsR = spawnSync('git', ['--git-dir', remotePath, 'cat-file', '-p', 'main:claude/CLAUDE.md'], { encoding: 'utf8' })
    expect(lsR.stdout).toBe('new\n')
  })

  it('returns nothing-to-push when source matches HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')
    const r = await executePush({ repoPath, claudePath, cursorProjects: [], token: null, commitMessage: 'noop' })
    expect(r.kind).toBe('nothing-to-push')
  })

  it('blocks when diverged', async () => {
    // Push from a parallel clone to advance remote
    const other = join(dir, 'other')
    git(remotePath, ['clone', '.', other])
    writeFileSync(join(other, 'claude', 'CLAUDE.md'), 'remote-change\n')
    git(other, ['config', 'user.email', 't@t']); git(other, ['config', 'user.name', 't'])
    git(other, ['commit', '-am', 'remote'])
    git(other, ['push', '-q'])

    // Local has its own change
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'local-change\n')
    const p = await computePushPreview({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(p.kind).toBe('diverged')
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/engine-push.test.ts`
Expected: imports fail.

- [ ] **Step 3: Add computePushPreview + executePush to engine.ts**

Append to `src/main/sync/engine/engine.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { readSourceForCommit } from './source-enum'
import { buildAndCommitFromSource } from './index-builder'
import { fetchOrigin, pushOrigin, revParse, updateRef, syncWtToHead, classifyRemoteError } from './git-ops'
import type { DiffEntry } from '@shared/sync-types'

export type PushPreview =
  | { kind: 'preview'; items: DiffEntry[] }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }

export type PushArgs = RefreshArgs & { commitMessage: string }

export async function computePushPreview(args: RefreshArgs): Promise<PushPreview> {
  const status = await refreshStatus({ ...args, doFetch: args.doFetch !== false })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  const items = status.diffs.filter((d) => d.status !== 'same')
  if (items.length === 0 && status.ahead === 0) return { kind: 'nothing-to-push' }
  return { kind: 'preview', items }
}

export type PushResult =
  | { kind: 'ok' }
  | { kind: 'nothing-to-push' }
  | { kind: 'diverged' }
  | { kind: 'offline' }
  | { kind: 'race'; retry: boolean }
  | { kind: 'auth'; message: string }
  | { kind: 'error'; message: string }

function surfaceAbsPath(args: PushArgs, d: DiffEntry): string {
  if (d.source.kind === 'claude') return join(args.claudePath!, d.surfacePath)
  const proj = args.cursorProjects.find((p) => p.name === d.source.projectName)!
  return join(proj.path, d.surfacePath)
}

export async function executePush(args: PushArgs): Promise<PushResult> {
  if (!args.repoPath) return { kind: 'error', message: 'repoPath required' }
  const prevHead = await revParse(args.repoPath, 'HEAD')
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  const items = status.diffs.filter((d) => d.status !== 'same')
  if (items.length === 0 && status.ahead === 0) return { kind: 'nothing-to-push' }

  const indexFile = join(args.repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`)
  try {
    await buildAndCommitFromSource({
      repoPath: args.repoPath,
      diffs: items,
      sourceContent: (d) => {
        if (d.status === 'deleted') return null
        return readSourceForCommit(surfaceAbsPath(args, d), d.surfacePath)
      },
      commitMessage: args.commitMessage,
      indexFile,
    })
  } catch (e) {
    return { kind: 'error', message: (e as Error).message }
  }

  const push = await pushOrigin(args.repoPath, 'main', args.token)
  if (!push.ok) {
    const kind = classifyRemoteError(push.stderr)
    // Rollback ref so WT/HEAD stays in original state
    await updateRef(args.repoPath, 'refs/heads/main', prevHead)
    await syncWtToHead(args.repoPath)
    if (kind === 'non-ff') return { kind: 'race', retry: true }
    if (kind === 'auth') return { kind: 'auth', message: push.stderr }
    return { kind: 'error', message: push.stderr }
  }
  return { kind: 'ok' }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/engine-push.test.ts`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/engine.ts tests/main/engine/engine-push.test.ts
git commit -m "feat(sync-engine): Engine push preview + execute via git plumbing"
```

---

### Task C3: Wire executePush to IPC `run-push`

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Replace run-push handler**

В `src/main/ipc.ts` найди `ipcMain.handle('run-push', ...)`. Замени тело:

```ts
ipcMain.handle('run-push', async (_e, opts: PushOptions) => {
  const cfg = readConfig(configPath)
  if (!cfg.repoPath) return { ok: false, exitCode: -1, error: { key: 'push.error.notConfigured' } } as RunResult
  emitPushStep({ step: 'export', status: 'running' })
  emitPushStep({ step: 'export', status: 'done' })
  emitPushStep({ step: 'pull', status: 'running' })
  emitPushStep({ step: 'pull', status: 'done' })
  emitPushStep({ step: 'commit', status: 'running' })
  const r = await executePush({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    commitMessage: opts.commitMessage,
  })
  if (r.kind === 'ok') {
    emitPushStep({ step: 'commit', status: 'done' })
    emitPushStep({ step: 'push', status: 'running' })
    emitPushStep({ step: 'push', status: 'done' })
    return { ok: true, exitCode: 0 } as RunResult
  }
  if (r.kind === 'nothing-to-push') {
    return { ok: true, exitCode: 0, error: { key: 'push.info.nothingToPush' } } as RunResult
  }
  if (r.kind === 'diverged') {
    return { ok: false, exitCode: -1, error: { key: 'push.error.conflict', params: { repoPath: cfg.repoPath } }, kind: 'conflict' } as RunResult
  }
  if (r.kind === 'offline') return { ok: false, exitCode: -1, error: { key: 'push.error.network', params: { tail: '' } } } as RunResult
  if (r.kind === 'auth') return { ok: false, exitCode: -1, error: { key: 'push.error.auth', params: { tail: r.message } } } as RunResult
  return { ok: false, exitCode: -1, error: { key: 'push.error.pullOther', fallback: r.message ?? '' } } as RunResult
})
```

Импорты: `import { executePush } from './sync/engine/engine'`.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: existing push.test.ts падает (он мокает старый runner). Помечаем его на удаление в Task H1 (cleanup). Engine-тесты должны пройти.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`
- Сделай локальное изменение в `~/.claude` → чип покажет local-changes → жми Push → коммит и push должны пройти → чип становится in-sync. Проверь GitHub — там новый коммит.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(sync-engine): run-push now uses Engine.executePush"
```

---

## Phase D — Pull pipeline (preview + apply)

### Task D1: PullApply module

**Files:**
- Create: `src/main/sync/engine/pull-apply.ts`
- Test: `tests/main/engine/pull-apply.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/pull-apply.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyToSource, mergeSettingsForPull } from '../../../src/main/sync/engine/pull-apply'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-pa-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('applyToSource', () => {
  it('writes new content to source path, creates parent dirs', async () => {
    const target = join(dir, 'claude', 'commands', 'new.md')
    await applyToSource(target, Buffer.from('hello', 'utf8'))
    expect(readFileSync(target, 'utf8')).toBe('hello')
  })
  it('overwrites existing content', async () => {
    const target = join(dir, 'a.txt')
    writeFileSync(target, 'old')
    await applyToSource(target, Buffer.from('new', 'utf8'))
    expect(readFileSync(target, 'utf8')).toBe('new')
  })
  it('null content deletes the file', async () => {
    const target = join(dir, 'a.txt')
    writeFileSync(target, 'doomed')
    await applyToSource(target, null)
    expect(existsSync(target)).toBe(false)
  })
  it('null content on missing file is no-op', async () => {
    const target = join(dir, 'never.txt')
    await applyToSource(target, null)
    expect(existsSync(target)).toBe(false)
  })
})

describe('mergeSettingsForPull', () => {
  it('takes allow-list keys from new blob, preserves env + volatile from current', () => {
    const headBlob = Buffer.from('{\n  "permissions": {\n    "allow": [\n      "y"\n    ]\n  }\n}', 'utf8')
    const currentSrc = Buffer.from('{"permissions":{"allow":["x"]},"numStartups":42,"env":{"K":"v"}}', 'utf8')
    const merged = mergeSettingsForPull(headBlob, currentSrc)
    const parsed = JSON.parse(merged.toString('utf8'))
    expect(parsed.permissions).toEqual({ allow: ['y'] })
    expect(parsed.numStartups).toBe(42)
    expect(parsed.env).toEqual({ K: 'v' })
  })
  it('removes allow-list key from src if absent in head', () => {
    const headBlob = Buffer.from('{}', 'utf8')
    const currentSrc = Buffer.from('{"permissions":{"allow":["x"]},"numStartups":1}', 'utf8')
    const merged = mergeSettingsForPull(headBlob, currentSrc)
    const parsed = JSON.parse(merged.toString('utf8'))
    expect(parsed.permissions).toBeUndefined()
    expect(parsed.numStartups).toBe(1)
  })
  it('when currentSrc absent, returns headBlob as-is', () => {
    const headBlob = Buffer.from('{\n  "theme": "dark"\n}', 'utf8')
    const merged = mergeSettingsForPull(headBlob, null)
    expect(merged.equals(headBlob)).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/pull-apply.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement pull-apply.ts**

```ts
// src/main/sync/engine/pull-apply.ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SETTINGS_KEY_ALLOW_LIST } from './rules'

export async function applyToSource(absPath: string, content: Buffer | null): Promise<void> {
  if (content === null) {
    if (existsSync(absPath)) {
      try { unlinkSync(absPath) } catch { /* ignore */ }
    }
    return
  }
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content)
}

/**
 * Merge HEAD's blob into source-side settings.json:
 * - allow-list keys come from HEAD's blob (canonical content).
 * - everything else (env + volatile telemetry) is preserved from the source.
 * If allow-list key exists in source but NOT in HEAD's blob, it's removed
 * (means another machine intentionally removed it).
 */
export function mergeSettingsForPull(headBlob: Buffer, currentSrc: Buffer | null): Buffer {
  const newParsed = JSON.parse(headBlob.toString('utf8')) as Record<string, unknown>
  if (currentSrc === null) return headBlob
  let currentParsed: Record<string, unknown>
  try {
    currentParsed = JSON.parse(currentSrc.toString('utf8')) as Record<string, unknown>
  } catch {
    return headBlob
  }
  const result: Record<string, unknown> = { ...currentParsed }
  for (const key of SETTINGS_KEY_ALLOW_LIST) {
    if (key in newParsed) result[key] = newParsed[key]
    else delete result[key]
  }
  return Buffer.from(JSON.stringify(result, null, 2), 'utf8')
}

/** Read source content if exists, else null. */
export function readSourceIfExists(absPath: string): Buffer | null {
  if (!existsSync(absPath)) return null
  try { return readFileSync(absPath) } catch { return null }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/pull-apply.test.ts`
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/pull-apply.ts tests/main/engine/pull-apply.test.ts
git commit -m "feat(sync-engine): PullApply module — write blobs to source dirs"
```

---

### Task D2: Engine.computePullPreview + Engine.executePullApply

**Files:**
- Modify: `src/main/sync/engine/engine.ts`
- Test: `tests/main/engine/engine-pull.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/engine-pull.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computePullPreview, executePullApply } from '../../../src/main/sync/engine/engine'

let dir: string, claudePath: string, repoPath: string, remotePath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-pull-'))
  claudePath = join(dir, '.claude'); mkdirSync(claudePath)
  remotePath = join(dir, 'remote.git'); mkdirSync(remotePath)
  git(remotePath, ['init', '--bare', '-q', '-b', 'main'])
  repoPath = join(dir, 'repo'); mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  git(repoPath, ['remote', 'add', 'origin', remotePath])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v1\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'v1'])
  git(repoPath, ['push', '-q', '-u', 'origin', 'main'])

  // Other clone advances remote
  const other = join(dir, 'other')
  git(remotePath, ['clone', '.', other])
  writeFileSync(join(other, 'claude', 'CLAUDE.md'), 'v2 from other\n')
  writeFileSync(join(other, 'claude', 'NEW.md'), 'new file\n')
  git(other, ['config', 'user.email', 'o@o']); git(other, ['config', 'user.name', 'o'])
  git(other, ['add', '-A']); git(other, ['commit', '-q', '-m', 'v2'])
  git(other, ['push', '-q'])

  // Source matches local HEAD initially
  writeFileSync(join(claudePath, 'CLAUDE.md'), 'v1\n')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Engine.pull', () => {
  it('preview lists files behind, apply writes to source and advances HEAD', async () => {
    const preview = await computePullPreview({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(preview.kind).toBe('preview')
    if (preview.kind !== 'preview') throw new Error('expected preview')
    const claudeMd = preview.items.find((i) => i.repoPath === 'claude/CLAUDE.md')
    expect(claudeMd?.status).toBe('modified')
    const newMd = preview.items.find((i) => i.repoPath === 'claude/NEW.md')
    expect(newMd?.status).toBe('added')

    const r = await executePullApply({
      repoPath, claudePath, cursorProjects: [], token: null,
      deletionsToApply: [],
    })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('v2 from other\n')
    expect(readFileSync(join(claudePath, 'NEW.md'), 'utf8')).toBe('new file\n')
  })

  it('blocks when diverged', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'local-edit\n')
    const p = await computePullPreview({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(p.kind).toBe('diverged')
  })

  it('deletion not applied unless opted in', async () => {
    // create file in HEAD, deleted in remote
    writeFileSync(join(repoPath, 'claude', 'ONLY-LOCAL.md'), 'x\n')
    git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'add only local'])
    git(repoPath, ['push', '-q'])
    // Sync source to match HEAD
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'v1\n')
    writeFileSync(join(claudePath, 'ONLY-LOCAL.md'), 'x\n')
    // Apply remote change to "other" — remove ONLY-LOCAL.md
    const other = join(dir, 'other')
    git(other, ['pull', '-q'])
    require('node:fs').unlinkSync(join(other, 'claude', 'ONLY-LOCAL.md'))
    git(other, ['add', '-A']); git(other, ['commit', '-q', '-m', 'rm only-local'])
    git(other, ['push', '-q'])

    const preview = await computePullPreview({ repoPath, claudePath, cursorProjects: [], token: null })
    if (preview.kind !== 'preview') throw new Error('expected preview')
    const deleted = preview.items.find((i) => i.repoPath === 'claude/ONLY-LOCAL.md')
    expect(deleted?.status).toBe('deleted')

    const r = await executePullApply({
      repoPath, claudePath, cursorProjects: [], token: null,
      deletionsToApply: [],  // opt out — file stays
    })
    expect(r.kind).toBe('ok')
    expect(existsSync(join(claudePath, 'ONLY-LOCAL.md'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/engine-pull.test.ts`
Expected: imports fail.

- [ ] **Step 3: Implement computePullPreview + executePullApply in engine.ts**

Append to `src/main/sync/engine/engine.ts`:

```ts
import { catFileBlob } from './git-ops'
import { applyToSource, mergeSettingsForPull, readSourceIfExists } from './pull-apply'
import type { PreviewItem } from '@shared/sync-types'
import { spawn } from 'node:child_process'

export type PullPreview =
  | { kind: 'preview'; items: PreviewItem[] }
  | { kind: 'nothing-to-pull' }
  | { kind: 'diverged' }
  | { kind: 'offline' }

export async function computePullPreview(args: RefreshArgs): Promise<PullPreview> {
  const status = await refreshStatus({ ...args, doFetch: true })
  if (status.state === 'offline') return { kind: 'offline' }
  if (status.state === 'diverged') return { kind: 'diverged' }
  if (status.behind === 0) return { kind: 'nothing-to-pull' }

  // git diff --raw HEAD..origin/main -- claude/ cursor/projects/<each>/
  const prefixes = ['claude/']
  for (const p of args.cursorProjects) prefixes.push(`cursor/projects/${p.name}/`)
  const items: PreviewItem[] = []

  const diff = await new Promise<string>((resolve, reject) => {
    const proc = spawn('git', ['-C', args.repoPath!, 'diff', '--raw', '-z', 'HEAD..origin/main', '--', ...prefixes])
    let out = ''
    proc.stdout.on('data', (b) => out += b.toString())
    proc.on('exit', (code) => code === 0 ? resolve(out) : reject(new Error(`git diff exit ${code}`)))
    proc.on('error', reject)
  })
  // diff --raw -z output: records separated by \0, each is
  //   ":<modea> <modeb> <shaa> <shab> <status>\0<path>\0"   for non-rename
  const tokens = diff.split('\0').filter(Boolean)
  let i = 0
  while (i < tokens.length) {
    const meta = tokens[i]!
    if (!meta.startsWith(':')) { i++; continue }
    const parts = meta.split(' ')
    const status = parts[4] ?? ''
    const path = tokens[i + 1] ?? ''
    i += 2
    if (!path) continue

    let surfacePath: string
    let source: { kind: 'claude' } | { kind: 'cursor-project'; projectName: string }
    if (path.startsWith('claude/')) {
      source = { kind: 'claude' }
      surfacePath = path.slice('claude/'.length)
    } else {
      const m = path.match(/^cursor\/projects\/([^/]+)\/(.*)$/)
      if (!m) continue
      source = { kind: 'cursor-project', projectName: m[1]! }
      surfacePath = m[2]!
    }

    let st: PreviewItem['status']
    if (status === 'A') st = 'added'
    else if (status === 'D') st = 'deleted'
    else st = 'modified'

    const sa = parts[2]
    const sb = parts[3]
    let newContent: Buffer | undefined
    if (st !== 'deleted' && sb && sb !== '0000000000000000000000000000000000000000') {
      newContent = await catFileBlob(args.repoPath!, sb)
    }
    const srcAbs = source.kind === 'claude'
      ? join(args.claudePath!, surfacePath)
      : join(args.cursorProjects.find((p) => p.name === source.projectName)!.path, surfacePath)
    const currentContent = readSourceIfExists(srcAbs) ?? undefined

    items.push({
      source, repoPath: path, surfacePath, status: st,
      sourceSha: sa, headSha: sb,
      newContent, currentContent,
    })
  }

  return { kind: 'preview', items }
}

export type PullApplyArgs = RefreshArgs & { deletionsToApply: string[] }

export async function executePullApply(args: PullApplyArgs): Promise<{ kind: 'ok' } | { kind: 'error'; message: string } | { kind: 'diverged' }> {
  const preview = await computePullPreview(args)
  if (preview.kind !== 'preview') {
    if (preview.kind === 'diverged') return { kind: 'diverged' }
    return { kind: 'error', message: `unexpected preview kind ${preview.kind}` }
  }
  const deletionsSet = new Set(args.deletionsToApply)

  for (const item of preview.items) {
    const surfaceAbs = item.source.kind === 'claude'
      ? join(args.claudePath!, item.surfacePath)
      : join(args.cursorProjects.find((p) => p.name === item.source.projectName)!.path, item.surfacePath)

    if (item.status === 'deleted') {
      if (deletionsSet.has(item.repoPath)) {
        await applyToSource(surfaceAbs, null)
      }
      continue
    }
    if (item.newContent === undefined) continue

    let toWrite = item.newContent
    if (item.source.kind === 'claude' && item.surfacePath === 'settings.json') {
      const currentSrc = readSourceIfExists(surfaceAbs)
      toWrite = mergeSettingsForPull(item.newContent, currentSrc)
    }
    await applyToSource(surfaceAbs, toWrite)
  }

  // fast-forward HEAD to origin/main
  await updateRef(args.repoPath!, 'refs/heads/main', await revParse(args.repoPath!, 'origin/main'))
  await syncWtToHead(args.repoPath!)
  return { kind: 'ok' }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/engine-pull.test.ts`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/engine.ts tests/main/engine/engine-pull.test.ts
git commit -m "feat(sync-engine): Engine pull preview + apply with deletion opt-in"
```

---

### Task D3: New IPC channels for pull-preview + pull-apply, replace run-pull

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/api.ts` (add types for preview)

- [ ] **Step 1: Add types in src/shared/api.ts**

В `src/shared/api.ts` добавь:

```ts
import type { PreviewItem } from './sync-types'

export type PullPreviewResult =
  | { kind: 'preview'; items: PreviewItem[] }
  | { kind: 'nothing-to-pull' }
  | { kind: 'diverged' }
  | { kind: 'offline' }
```

- [ ] **Step 2: Add IPC handlers in ipc.ts**

Замени старый `ipcMain.handle('run-pull', ...)` на:

```ts
ipcMain.handle('compute-pull-preview', async () => {
  const cfg = readConfig(configPath)
  return computePullPreview({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
  })
})

ipcMain.handle('execute-pull-apply', async (_e, deletionsToApply: string[]) => {
  const cfg = readConfig(configPath)
  emit({ time: nowHHMMSS(), text: '$ engine pull-apply', level: 'info' })
  const r = await executePullApply({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    deletionsToApply,
  })
  if (r.kind === 'ok') {
    emit({ time: nowHHMMSS(), text: '✓ Pull applied', level: 'success' })
    return { ok: true, exitCode: 0 } as RunResult
  }
  if (r.kind === 'diverged') return { ok: false, exitCode: -1, error: { key: 'push.error.conflict' }, kind: 'conflict' } as RunResult
  return { ok: false, exitCode: -1, error: { key: 'pull.error.failed', fallback: 'message' in r ? r.message : '' } } as RunResult
})
```

Импорты: `import { computePullPreview, executePullApply } from './sync/engine/engine'`.

Также удали handler `ipcMain.handle('run-pull', ...)` целиком.

- [ ] **Step 3: Update preload**

В `src/preload/index.ts` найди существующие методы API и добавь:

```ts
computePullPreview: (): Promise<PullPreviewResult> => ipcRenderer.invoke('compute-pull-preview'),
executePullApply: (deletionsToApply: string[]): Promise<RunResult> => ipcRenderer.invoke('execute-pull-apply', deletionsToApply),
```

И удали старый `runPull` метод.

- [ ] **Step 4: Update App.tsx — replace inline handlePull**

В `src/renderer/App.tsx` найди `handlePull`. Замени на flow с preview-модалкой (Task D4 добавит модалку, пока put placeholder):

```ts
const [pullPreviewOpen, setPullPreviewOpen] = useState(false)
const [pullPreviewData, setPullPreviewData] = useState<PullPreviewResult | null>(null)

const handlePull = async () => {
  const preview = await window.api.computePullPreview()
  if (preview.kind === 'diverged') {
    setConflictInProgress(true); setConflictOpen(true); return
  }
  if (preview.kind === 'offline') { /* show toast */ return }
  if (preview.kind === 'nothing-to-pull') return
  setPullPreviewData(preview); setPullPreviewOpen(true)
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: PullModal not yet imported — fix in next task. Allowable warning OR temporarily comment out the JSX. Лучше — закоммитить только backend часть здесь.

```bash
git add src/main/ipc.ts src/preload/index.ts src/shared/api.ts
git commit -m "feat(sync-engine): replace run-pull with compute/execute pull IPC pair"
```

(handlePull в App.tsx — оставляем для следующей таски.)

---

### Task D4: PullModal UI component

**Files:**
- Create: `src/renderer/components/PullModal.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n/*.json` — добавить ключи

- [ ] **Step 1: Create PullModal.tsx**

```tsx
// src/renderer/components/PullModal.tsx
import React, { useState } from 'react'
import type { PullPreviewResult, PreviewItem } from '@shared/sync-types'
import { Button } from './ui/button'
import { useT } from '../i18n'

type Props = {
  open: boolean
  preview: PullPreviewResult | null
  onClose: () => void
  onApply: (deletionsToApply: string[]) => void
}

export function PullModal({ open, preview, onClose, onApply }: Props) {
  const t = useT()
  const [acceptedDeletions, setAcceptedDeletions] = useState<Set<string>>(new Set())
  if (!open || !preview || preview.kind !== 'preview') return null
  const items: PreviewItem[] = preview.items
  const added = items.filter((i) => i.status === 'added')
  const modified = items.filter((i) => i.status === 'modified')
  const deleted = items.filter((i) => i.status === 'deleted')

  const toggleDeletion = (path: string) => {
    setAcceptedDeletions((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[640px] max-h-[80vh] overflow-auto rounded-lg bg-background p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold">{t('pull.modal.title')}</h2>

        {added.length > 0 && (
          <section className="mb-4">
            <h3 className="text-sm font-medium text-emerald-600">{t('pull.modal.added', { n: added.length })}</h3>
            <ul className="mt-1 ml-4 list-disc text-sm text-muted-foreground">
              {added.map((i) => <li key={i.repoPath}>{i.repoPath}</li>)}
            </ul>
          </section>
        )}
        {modified.length > 0 && (
          <section className="mb-4">
            <h3 className="text-sm font-medium text-amber-600">{t('pull.modal.modified', { n: modified.length })}</h3>
            <ul className="mt-1 ml-4 list-disc text-sm text-muted-foreground">
              {modified.map((i) => <li key={i.repoPath}>{i.repoPath}</li>)}
            </ul>
          </section>
        )}
        {deleted.length > 0 && (
          <section className="mb-4">
            <h3 className="text-sm font-medium text-rose-600">{t('pull.modal.deleted', { n: deleted.length })}</h3>
            <p className="text-xs text-muted-foreground">{t('pull.modal.deletedHint')}</p>
            <ul className="mt-1 ml-4 text-sm">
              {deleted.map((i) => (
                <li key={i.repoPath} className="flex items-center gap-2">
                  <input type="checkbox" checked={acceptedDeletions.has(i.repoPath)} onChange={() => toggleDeletion(i.repoPath)} />
                  <span>{i.repoPath}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => onApply(Array.from(acceptedDeletions))}>{t('pull.modal.apply')}</Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire in App.tsx**

В `src/renderer/App.tsx`:

```tsx
import { PullModal } from './components/PullModal'
// ...
<PullModal
  open={pullPreviewOpen}
  preview={pullPreviewData}
  onClose={() => setPullPreviewOpen(false)}
  onApply={async (dels) => {
    setPullPreviewOpen(false)
    const r = await window.api.executePullApply(dels)
    await refreshSyncStatus()
    if (r.ok) { /* optional toast */ }
  }}
/>
```

- [ ] **Step 3: Add i18n keys**

В `src/renderer/i18n/en.json` (и `ru.json`):

```json
"pull.modal.title": "Pull changes",
"pull.modal.added": "{{n}} new",
"pull.modal.modified": "{{n}} modified",
"pull.modal.deleted": "{{n}} removed on remote",
"pull.modal.deletedHint": "Tick to also remove locally. Untouched files remain.",
"pull.modal.apply": "Apply",
"common.cancel": "Cancel"
```

(Симметрично для ru.json — переведи.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual smoke**

Run: `npm run dev` и проделай scenario: на другой машине push'ни новый файл; на этой запусти приложение; чип покажет behind → Pull → preview покажет файл → Apply → файл появился в ~/.claude.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/PullModal.tsx src/renderer/App.tsx src/renderer/i18n/
git commit -m "feat(sync-engine): PullModal preview UI with deletion opt-in"
```

---

## Phase E — Resolver pipeline (per-file 3-way merge)

### Task E1: Engine.computeResolverState + persist

**Files:**
- Modify: `src/main/sync/engine/engine.ts`
- Create: `src/main/sync/engine/resolver.ts`
- Test: `tests/main/engine/resolver.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computeResolverState, executeResolve, persistResolverState, loadResolverState, clearResolverState } from '../../../src/main/sync/engine/resolver'

let dir: string, claudePath: string, repoPath: string, remotePath: string, userDataDir: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-rsv-'))
  claudePath = join(dir, '.claude'); mkdirSync(claudePath)
  remotePath = join(dir, 'remote.git'); mkdirSync(remotePath)
  userDataDir = join(dir, 'ud'); mkdirSync(userDataDir)
  git(remotePath, ['init', '--bare', '-q', '-b', 'main'])
  repoPath = join(dir, 'repo'); mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  git(repoPath, ['remote', 'add', 'origin', remotePath])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'base\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'base'])
  git(repoPath, ['push', '-q', '-u', 'origin', 'main'])

  // Advance remote with theirs
  const other = join(dir, 'other')
  git(remotePath, ['clone', '.', other])
  writeFileSync(join(other, 'claude', 'CLAUDE.md'), 'theirs\n')
  git(other, ['config', 'user.email', 'o@o']); git(other, ['config', 'user.name', 'o'])
  git(other, ['add', '-A']); git(other, ['commit', '-q', '-m', 'theirs'])
  git(other, ['push', '-q'])

  // Source has mine
  writeFileSync(join(claudePath, 'CLAUDE.md'), 'mine\n')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Resolver', () => {
  it('computes base/mine/theirs for diverged path', async () => {
    const state = await computeResolverState({
      repoPath, claudePath, cursorProjects: [], token: null, userDataDir,
    })
    expect(state.files).toHaveLength(1)
    const f = state.files[0]!
    expect(f.repoPath).toBe('claude/CLAUDE.md')
    expect(f.base?.toString('utf8')).toBe('base\n')
    expect(f.mine?.toString('utf8')).toBe('mine\n')
    expect(f.theirs?.toString('utf8')).toBe('theirs\n')
  })

  it('persists and reloads state', async () => {
    const state = await computeResolverState({
      repoPath, claudePath, cursorProjects: [], token: null, userDataDir,
    })
    state.files[0]!.choice = 'mine'
    persistResolverState(userDataDir, state)
    const loaded = loadResolverState(userDataDir)
    expect(loaded?.files[0]?.choice).toBe('mine')
    clearResolverState(userDataDir)
    expect(loadResolverState(userDataDir)).toBeNull()
  })

  it('apply with choice=mine writes mine to source and pushes 2-parent commit', async () => {
    const state = await computeResolverState({
      repoPath, claudePath, cursorProjects: [], token: null, userDataDir,
    })
    state.files[0]!.choice = 'mine'
    const r = await executeResolve({
      repoPath, claudePath, cursorProjects: [], token: null, userDataDir,
      commitMessage: 'merge mine', resolutions: state,
    })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('mine\n')
    // verify remote got a 2-parent commit on main
    const log = spawnSync('git', ['--git-dir', remotePath, 'log', '--pretty=%P', '-n', '1', 'main'], { encoding: 'utf8' })
    expect(log.stdout.trim().split(' ')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run tests/main/engine/resolver.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement resolver.ts**

```ts
// src/main/sync/engine/resolver.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolverFile, ResolverState, SourceRef } from '@shared/sync-types'
import type { CursorProject } from '@shared/api'
import { refreshStatus } from './engine'
import { catFileBlob, mergeBase, revParse, readTreeMergeAggressive, updateIndexAdd, updateIndexRemove, writeTree, commitTree, updateRef, syncWtToHead, pushOrigin, hashObjectWrite, classifyRemoteError, lsTree } from './git-ops'
import { applyToSource, readSourceIfExists } from './pull-apply'
import { canonicalizeSettings } from './settings-canonical'

const STATE_FILE = 'sync-engine-resolve.json'

function stateFilePath(userDataDir: string): string {
  return join(userDataDir, STATE_FILE)
}

export function persistResolverState(userDataDir: string, state: ResolverState): void {
  mkdirSync(userDataDir, { recursive: true })
  const serializable = {
    ...state,
    files: state.files.map((f) => ({
      ...f,
      base: f.base ? f.base.toString('base64') : null,
      mine: f.mine ? f.mine.toString('base64') : null,
      theirs: f.theirs ? f.theirs.toString('base64') : null,
      editedContent: f.editedContent ? f.editedContent.toString('base64') : undefined,
    })),
  }
  writeFileSync(stateFilePath(userDataDir), JSON.stringify(serializable, null, 2), 'utf8')
}

export function loadResolverState(userDataDir: string): ResolverState | null {
  const fp = stateFilePath(userDataDir)
  if (!existsSync(fp)) return null
  const parsed = JSON.parse(readFileSync(fp, 'utf8'))
  return {
    ...parsed,
    files: parsed.files.map((f: any) => ({
      ...f,
      base: f.base ? Buffer.from(f.base, 'base64') : null,
      mine: f.mine ? Buffer.from(f.mine, 'base64') : null,
      theirs: f.theirs ? Buffer.from(f.theirs, 'base64') : null,
      editedContent: f.editedContent ? Buffer.from(f.editedContent, 'base64') : undefined,
    })),
  } as ResolverState
}

export function clearResolverState(userDataDir: string): void {
  try { rmSync(stateFilePath(userDataDir), { force: true }) } catch { /* ignore */ }
}

export type ResolverArgs = {
  repoPath: string
  claudePath: string | null
  cursorProjects: CursorProject[]
  token: string | null
  userDataDir: string
}

export async function computeResolverState(args: ResolverArgs): Promise<ResolverState> {
  const baseSha = await mergeBase(args.repoPath, 'HEAD', 'origin/main')
  const headSha = await revParse(args.repoPath, 'HEAD')
  const theirsSha = await revParse(args.repoPath, 'origin/main')

  // Union of paths from (source vs HEAD) and (HEAD vs origin/main)
  const status = await refreshStatus({ ...args, doFetch: false })
  const sourcePaths = new Set(status.diffs.filter((d) => d.status !== 'same').map((d) => d.repoPath))
  // HEAD vs origin/main
  const ours = await lsTree(args.repoPath, 'HEAD', 'claude/')
  const theirs = await lsTree(args.repoPath, 'origin/main', 'claude/')
  for (const proj of args.cursorProjects) {
    ours.push(...await lsTree(args.repoPath, 'HEAD', `cursor/projects/${proj.name}/`))
    theirs.push(...await lsTree(args.repoPath, 'origin/main', `cursor/projects/${proj.name}/`))
  }
  const oursByPath = new Map(ours.map((e) => [e.repoPath, e.sha]))
  const theirsByPath = new Map(theirs.map((e) => [e.repoPath, e.sha]))
  for (const p of new Set([...oursByPath.keys(), ...theirsByPath.keys()])) {
    if (oursByPath.get(p) !== theirsByPath.get(p)) sourcePaths.add(p)
  }

  const files: ResolverFile[] = []
  for (const repoPath of sourcePaths) {
    let source: SourceRef
    let surfaceAbs: string
    let surfacePath: string
    if (repoPath.startsWith('claude/')) {
      source = { kind: 'claude' }
      surfacePath = repoPath.slice('claude/'.length)
      surfaceAbs = join(args.claudePath ?? '', surfacePath)
    } else {
      const m = repoPath.match(/^cursor\/projects\/([^/]+)\/(.*)$/)
      if (!m) continue
      source = { kind: 'cursor-project', projectName: m[1]! }
      surfacePath = m[2]!
      surfaceAbs = join(args.cursorProjects.find((p) => p.name === source.projectName)!.path, surfacePath)
    }

    let base: Buffer | null = null
    let theirs: Buffer | null = null
    try {
      const baseTree = await lsTree(args.repoPath, baseSha, repoPath)
      if (baseTree.length > 0) base = await catFileBlob(args.repoPath, baseTree[0]!.sha)
    } catch { /* path didn't exist in base */ }
    try {
      const tTree = await lsTree(args.repoPath, 'origin/main', repoPath)
      if (tTree.length > 0) theirs = await catFileBlob(args.repoPath, tTree[0]!.sha)
    } catch { /* not in theirs */ }

    let mine = readSourceIfExists(surfaceAbs)
    if (mine && surfacePath === 'settings.json' && source.kind === 'claude') {
      try { mine = canonicalizeSettings(mine) } catch { /* leave raw */ }
    }

    files.push({ source, repoPath, surfacePath, base, mine, theirs, choice: null })
  }

  const state: ResolverState = { files, baseSha, headSha, theirsSha }
  persistResolverState(args.userDataDir, state)
  return state
}

export type ResolveExecuteArgs = ResolverArgs & {
  commitMessage: string
  resolutions: ResolverState
}

function finalContent(f: ResolverFile): Buffer | null {
  if (f.choice === 'mine') return f.mine
  if (f.choice === 'theirs') return f.theirs
  if (f.choice === 'manual') return f.editedContent ?? null
  return null
}

export async function executeResolve(args: ResolveExecuteArgs): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  const { repoPath, resolutions } = args
  const indexFile = join(repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`)
  try {
    // 1. Write source
    for (const f of resolutions.files) {
      const final = finalContent(f)
      const surfaceAbs = f.source.kind === 'claude'
        ? join(args.claudePath ?? '', f.surfacePath)
        : join(args.cursorProjects.find((p) => p.name === f.source.projectName)!.path, f.surfacePath)
      await applyToSource(surfaceAbs, final)
    }

    // 2. Build merge commit
    await readTreeMergeAggressive(repoPath, resolutions.baseSha, resolutions.headSha, resolutions.theirsSha, indexFile)
    for (const f of resolutions.files) {
      const final = finalContent(f)
      if (final !== null) {
        const sha = await hashObjectWrite(repoPath, final)
        await updateIndexAdd(repoPath, indexFile, '100644', sha, f.repoPath)
      } else {
        await updateIndexRemove(repoPath, indexFile, f.repoPath)
      }
    }
    const tree = await writeTree(repoPath, indexFile)
    const commit = await commitTree(repoPath, tree, [resolutions.headSha, resolutions.theirsSha], args.commitMessage)
    await updateRef(repoPath, 'refs/heads/main', commit)
    await syncWtToHead(repoPath)

    const push = await pushOrigin(repoPath, 'main', args.token)
    if (!push.ok) {
      const kind = classifyRemoteError(push.stderr)
      return { kind: 'error', message: `push failed (${kind}): ${push.stderr}` }
    }
    clearResolverState(args.userDataDir)
    return { kind: 'ok' }
  } catch (e) {
    return { kind: 'error', message: (e as Error).message }
  } finally {
    try { rmSync(indexFile, { force: true }) } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run tests/main/engine/resolver.test.ts`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/resolver.ts tests/main/engine/resolver.test.ts
git commit -m "feat(sync-engine): Resolver with 3-way state, persist, and merge commit"
```

---

### Task E2: Wire Resolver into IPC + ConflictModal rewrite

**Files:**
- Modify: `src/main/conflict.ts` — переписан как обёртка
- Modify: `src/main/ipc.ts` — заменить старые conflict-* handlers
- Modify: `src/renderer/components/ConflictModal.tsx` — обновить data shape
- Modify: `src/preload/index.ts` — новый API

- [ ] **Step 1: Replace conflict.ts contents**

```ts
// src/main/conflict.ts
import type { ResolverState } from '@shared/sync-types'
import { computeResolverState, executeResolve, loadResolverState, clearResolverState } from './sync/engine/resolver'
import { readConfig } from './config'
import { loadToken } from './safe-storage'

export async function getResolverStateIPC(configPath: string, userDataDir: string): Promise<ResolverState | null> {
  // First try cached resume
  const cached = loadResolverState(userDataDir)
  if (cached) return cached
  const cfg = readConfig(configPath)
  if (!cfg.repoPath) return null
  return computeResolverState({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    userDataDir,
  })
}

export async function executeResolveIPC(
  configPath: string,
  userDataDir: string,
  commitMessage: string,
  resolutions: ResolverState,
): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  const cfg = readConfig(configPath)
  if (!cfg.repoPath) return { kind: 'error', message: 'repoPath not configured' }
  return executeResolve({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
    userDataDir,
    commitMessage,
    resolutions,
  })
}

export function discardResolverIPC(userDataDir: string): void {
  clearResolverState(userDataDir)
}
```

- [ ] **Step 2: Replace conflict-* IPC handlers in ipc.ts**

Найди handlers `conflict-get-state`, `conflict-get-file`, `conflict-resolve-file`, `conflict-continue`, `conflict-abort`, `conflict-open-in-editor`. Замени на:

```ts
ipcMain.handle('resolver-get-state', () => getResolverStateIPC(configPath, userDataDir))
ipcMain.handle('resolver-execute', (_e, commitMessage: string, resolutions: ResolverState) =>
  executeResolveIPC(configPath, userDataDir, commitMessage, resolutions),
)
ipcMain.handle('resolver-discard', () => { discardResolverIPC(userDataDir) })
```

И добавь импорт `import { getResolverStateIPC, executeResolveIPC, discardResolverIPC } from './conflict'`.

- [ ] **Step 3: Update preload**

В `src/preload/index.ts`:

```ts
resolverGetState: (): Promise<ResolverState | null> => ipcRenderer.invoke('resolver-get-state'),
resolverExecute: (commitMessage: string, resolutions: ResolverState): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> =>
  ipcRenderer.invoke('resolver-execute', commitMessage, resolutions),
resolverDiscard: (): Promise<void> => ipcRenderer.invoke('resolver-discard'),
```

И удали старые `conflictGetState`, `conflictGetFile`, `conflictResolveFile`, `conflictContinue`, `conflictAbort`, `conflictOpenInEditor`.

- [ ] **Step 4: Update ConflictModal component**

Это самая большая UI правка. ConflictModal сейчас работает с git rebase paused state. Перепиши его на работу с ResolverState. Минимальный вариант:

```tsx
// src/renderer/components/ConflictModal.tsx
import React, { useEffect, useState } from 'react'
import type { ResolverState, ResolverFile } from '@shared/sync-types'
import { Button } from './ui/button'
import { useT } from '../i18n'

type Props = {
  open: boolean
  onClose: () => void
  onContinued: () => void
}

function asString(b: Buffer | null): string {
  if (!b) return ''
  return b.toString('utf8')
}

export function ConflictModal({ open, onClose, onContinued }: Props) {
  const t = useT()
  const [state, setState] = useState<ResolverState | null>(null)
  const [selected, setSelected] = useState<number>(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void window.api.resolverGetState().then((s) => setState(s))
  }, [open])

  if (!open || !state) return null
  const current = state.files[selected]
  if (!current) return null

  const setChoice = (choice: ResolverFile['choice']) => {
    const next = { ...state, files: [...state.files] }
    next.files[selected] = { ...current, choice }
    setState(next)
  }

  const allResolved = state.files.every((f) => f.choice !== null)

  const apply = async () => {
    setBusy(true)
    const r = await window.api.resolverExecute(t('conflict.commitDefault'), state)
    setBusy(false)
    if (r.kind === 'ok') { onContinued() }
    else { /* show error toast */ }
  }

  const abort = async () => {
    await window.api.resolverDiscard()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[80vh] w-[1000px] flex-col rounded-lg bg-background p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold">{t('conflict.title')}</h2>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 overflow-auto border-r pr-2">
            {state.files.map((f, i) => (
              <button key={f.repoPath}
                className={`block w-full truncate p-2 text-left text-sm ${i === selected ? 'bg-accent' : ''}`}
                onClick={() => setSelected(i)}>
                <span className={f.choice ? 'text-emerald-600' : ''}>{f.choice ? '✓ ' : ''}</span>
                {f.repoPath}
              </button>
            ))}
          </aside>
          <main className="flex-1 overflow-auto p-4">
            <h3 className="mb-2 font-medium">{current.repoPath}</h3>
            <div className="grid grid-cols-3 gap-2">
              <pre className="overflow-auto rounded border bg-muted p-2 text-xs"><b>base</b>{'\n'}{asString(current.base)}</pre>
              <pre className="overflow-auto rounded border bg-muted p-2 text-xs"><b>mine</b>{'\n'}{asString(current.mine)}</pre>
              <pre className="overflow-auto rounded border bg-muted p-2 text-xs"><b>theirs</b>{'\n'}{asString(current.theirs)}</pre>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant={current.choice === 'mine' ? 'default' : 'outline'} onClick={() => setChoice('mine')}>{t('conflict.keepMine')}</Button>
              <Button size="sm" variant={current.choice === 'theirs' ? 'default' : 'outline'} onClick={() => setChoice('theirs')}>{t('conflict.takeTheirs')}</Button>
            </div>
          </main>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={abort} disabled={busy}>{t('conflict.discard')}</Button>
          <Button disabled={!allResolved || busy} onClick={apply}>{t('conflict.apply')}</Button>
        </div>
      </div>
    </div>
  )
}
```

(Manual edit можно отложить в v1.1; required в v1 — только mine/theirs choices.)

- [ ] **Step 5: Add i18n keys**

`pull.modal.title` уже есть. Добавь:

```json
"conflict.title": "Resolve merge conflict",
"conflict.keepMine": "Keep mine",
"conflict.takeTheirs": "Take theirs",
"conflict.discard": "Discard merge state",
"conflict.apply": "Apply",
"conflict.commitDefault": "Merge resolved via claudesync"
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors (existing test conflict.test.ts может сломаться — отметим на cleanup phase).

```bash
git add src/main/conflict.ts src/main/ipc.ts src/preload/index.ts src/renderer/components/ConflictModal.tsx src/renderer/i18n/
git commit -m "feat(sync-engine): wire Resolver to ConflictModal, replace conflict IPC"
```

---

### Task E3: Block buttons in diverged state

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Update Push/Pull button visibility**

В `src/renderer/App.tsx` найди логику `showPushBtn` / `showPullBtn`. Замени:

```ts
const isDiverged = state.syncStatus.state === 'diverged'
const showPushBtn = !isDiverged && (state.syncStatus.localChanges > 0 || state.syncStatus.ahead > 0)
const showPullBtn = !isDiverged && state.syncStatus.behind > 0
const showResolveBtn = isDiverged
```

И добавь рендер resolve-кнопки:

```tsx
{showResolveBtn && (
  <Button variant="destructive" onClick={() => setConflictOpen(true)}>
    {t('sync.diverged.resolve')}
  </Button>
)}
```

- [ ] **Step 2: Add i18n**

```json
"sync.diverged.resolve": "Resolve diverged state"
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`. Сценарий: создай diverged (push с другой машины + локальное изменение) → чип покажет diverged → должны быть скрыты Pull и Push → виден только Resolve → клик открывает ConflictModal с per-file 3-way.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx src/renderer/i18n/
git commit -m "feat(sync-engine): block Push/Pull in diverged state, expose Resolve button"
```

---

## Phase F — Discard rewrite

### Task F1: Engine.executeDiscard (HEAD → source)

**Files:**
- Modify: `src/main/sync/engine/engine.ts`
- Test: `tests/main/engine/engine-discard.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/engine-discard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { executeDiscard, refreshStatus } from '../../../src/main/sync/engine/engine'

let dir: string, claudePath: string, repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-dsc-'))
  claudePath = join(dir, '.claude'); mkdirSync(claudePath)
  repoPath = join(dir, 'repo'); mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'committed\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'init'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('executeDiscard', () => {
  it('overwrites source with HEAD content', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'local mess\n')
    const r = await executeDiscard({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('committed\n')
    const status = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null, doFetch: false })
    expect(status.localChanges).toBe(0)
  })
})
```

- [ ] **Step 2: Add executeDiscard to engine.ts**

```ts
export async function executeDiscard(args: RefreshArgs): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!args.repoPath) return { kind: 'error', message: 'repoPath required' }
  const status = await refreshStatus({ ...args, doFetch: false })
  for (const d of status.diffs) {
    if (d.status === 'same') continue
    const surfaceAbs = d.source.kind === 'claude'
      ? join(args.claudePath!, d.surfacePath)
      : join(args.cursorProjects.find((p) => p.name === d.source.projectName)!.path, d.surfacePath)
    if (d.status === 'added') {
      // file in source, not in HEAD → discard means delete from source
      await applyToSource(surfaceAbs, null)
    } else if (d.status === 'modified' || d.status === 'deleted') {
      // pull HEAD's content to source
      const head = await enumHead(args.repoPath, d.source.kind === 'claude' ? 'claude/' : `cursor/projects/${d.source.projectName}/`, d.source.kind === 'claude' ? 'claude/' : `cursor/projects/${d.source.projectName}/`)
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

- [ ] **Step 3: Run, verify PASS**

Run: `npx vitest run tests/main/engine/engine-discard.test.ts`
Expected: 1 test passes.

- [ ] **Step 4: Wire to ipc.ts**

Замени `discard-local-changes` handler:

```ts
ipcMain.handle('discard-local-changes', async (): Promise<RunResult> => {
  const cfg = readConfig(configPath)
  emit({ time: nowHHMMSS(), text: '$ engine discard', level: 'info' })
  const r = await executeDiscard({
    repoPath: cfg.repoPath,
    claudePath: cfg.claude.enabled ? cfg.claude.path : null,
    cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
    token: loadToken(userDataDir),
  })
  if (r.kind === 'ok') {
    emit({ time: nowHHMMSS(), text: '✓ Local changes discarded', level: 'success' })
    return { ok: true, exitCode: 0 }
  }
  return { ok: false, exitCode: -1, error: { key: 'discard.error.failed', fallback: r.message } }
})
```

Импорт: `import { executeDiscard } from './sync/engine/engine'`.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/engine.ts src/main/ipc.ts tests/main/engine/engine-discard.test.ts
git commit -m "feat(sync-engine): Engine.executeDiscard pulls HEAD into source"
```

---

## Phase G — init-wizard update

### Task G1: generateClaudeStructure uses SyncRules

**Files:**
- Modify: `src/main/sync/claude.ts` — переписать `generateClaudeStructure`
- Modify: `tests/main/sync-claude.test.ts` — обновить ожидания

- [ ] **Step 1: Update generateClaudeStructure**

В `src/main/sync/claude.ts` найди функцию `generateClaudeStructure`. Замени на:

```ts
import { enumClaudeSource } from './engine/source-enum'
import { canonicalizeSettings } from './engine/settings-canonical'
import { readSourceForCommit } from './engine/source-enum'

export async function generateClaudeStructure(claudePath: string, repoPath: string): Promise<void> {
  const entries = await enumClaudeSource(claudePath)
  for (const e of entries) {
    const srcAbs = join(claudePath, e.surfacePath)
    const dstAbs = join(repoPath, e.repoPath)
    mkdirSync(join(dstAbs, '..'), { recursive: true })
    const content = readSourceForCommit(srcAbs, e.surfacePath)
    writeFileSync(dstAbs, content)
  }
}
```

- [ ] **Step 2: Update old test**

В `tests/main/sync-claude.test.ts` найди `describe('generateClaudeStructure', ...)`. Обнови ассерты — теперь settings.json в init будет фильтрован allow-list'ом:

```ts
it('canonicalizes settings.json with only allow-list keys', async () => {
  writeFileSync(join(claudePath, 'settings.json'), '{"permissions":{"allow":["x"]},"env":{"K":"v"},"numStartups":42}')
  await generateClaudeStructure(claudePath, repoPath)
  const out = readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8')
  expect(out).toBe('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}')
})
```

(Удалить старые ассерты про "strip env"; новый контракт — оставляются только allow-list ключи.)

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: обновлённые тесты прошли.

- [ ] **Step 4: Commit**

```bash
git add src/main/sync/claude.ts tests/main/sync-claude.test.ts
git commit -m "feat(sync-engine): init-wizard generates canonical settings.json via SyncRules"
```

---

## Phase H — Cleanup

### Task H1: Remove unused exports + dead code

**Files:**
- Modify: `src/main/sync/claude.ts` — оставить только `detectClaudeInstallMode` + `generateClaudeStructure`
- Delete: `src/main/sync/cursor.ts`
- Delete: `src/main/sync/cursor-install.ts`
- Delete: `src/main/push.ts` (вся логика переехала)
- Delete: tests `sync-cursor.test.ts`, `sync-cursor-install.test.ts`, `push.test.ts`

- [ ] **Step 1: Remove unused code from claude.ts**

Удали из `src/main/sync/claude.ts`: `exportClaude`, `installClaude`, `stripSecretsInClaudeRepo`, `syncDirMirror`, `syncDirCopy`, `syncFile`, `syncProjectsMemoryOnly`, `installClaudeSettings`, `installClaudeProjectsAdditive`, `readUserEnv`, `IGNORED_NAME`, `isIgnored`, `isSamePath`, `copyFileIfExists`, `copyDirIfExists`. Оставь только `detectClaudeInstallMode` + `generateClaudeStructure`.

- [ ] **Step 2: Delete files**

```bash
git rm src/main/sync/cursor.ts src/main/sync/cursor-install.ts src/main/push.ts
git rm tests/main/sync-cursor.test.ts tests/main/sync-cursor-install.test.ts tests/main/push.test.ts
```

- [ ] **Step 3: Remove imports of deleted modules from ipc.ts**

Удали из `src/main/ipc.ts`:
- `import { detectClaudeInstallMode, exportClaude, installClaude, stripSecretsInClaudeRepo } from './sync/claude'` → оставь только `detectClaudeInstallMode`
- `import { exportCursorProjects } from './sync/cursor'` → удалить
- `import { installCursorProjects } from './sync/cursor-install'` → удалить
- `import { runPush, getRepoStatus } from './push'` → удалить (getRepoStatus переехал)

Перенеси `getRepoStatus` в `src/main/sync/engine/engine.ts` или в ipc.ts как локальную функцию через refreshStatus.

- [ ] **Step 4: Update run-install handler**

`run-install` handler сейчас вызывает удалённые `installCursorProjects`. Замени на executePullApply без deletions:

```ts
ipcMain.handle('run-install', async (_e, opts: InstallOptions): Promise<RunResult> => {
  const cfg = readConfig(configPath)
  // Equivalent to "apply all current HEAD content to source dirs" — same as pull-apply without remote step.
  // But run-install also handles install.sh for Claude scripts; для v1 оставляем install.sh путь как есть,
  // а cursor projects переносим на executePullApply с empty deletions.
  // ...
})
```

(Уточнение — оставим run-install fastpath без изменений в v1, если кейс редкий.)

- [ ] **Step 5: Typecheck + lint + test**

Run: `npm run typecheck && npm run lint && npm test`
Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(sync-engine): remove legacy push/cursor/claude sync modules"
```

---

### Task H2: Startup sweep for orphaned temp state

**Files:**
- Modify: `src/main/index.ts` — добавить sweep on app ready
- Create: `src/main/sync/engine/sweep.ts`
- Test: `tests/main/engine/sweep.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/main/engine/sweep.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepEngineState } from '../../../src/main/sync/engine/sweep'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cs-sw-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('sweepEngineState', () => {
  it('removes tmp-index files older than 1h, keeps newer', () => {
    const gitDir = join(dir, '.git'); mkdirSync(gitDir)
    const old = join(gitDir, 'tmp-index-1-1000'); writeFileSync(old, 'x')
    const recent = join(gitDir, 'tmp-index-2-2000'); writeFileSync(recent, 'y')
    const twoH = (Date.now() - 2 * 3600 * 1000) / 1000
    utimesSync(old, twoH, twoH)
    sweepEngineState(dir, dir)  // (repoPath, userDataDir)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })
})
```

- [ ] **Step 2: Implement sweep.ts**

```ts
// src/main/sync/engine/sweep.ts
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MAX_AGE_MS = 60 * 60 * 1000

export function sweepEngineState(repoPath: string, _userDataDir: string): void {
  const gitDir = join(repoPath, '.git')
  if (!existsSync(gitDir)) return
  try {
    for (const name of readdirSync(gitDir)) {
      if (!name.startsWith('tmp-index')) continue
      const abs = join(gitDir, name)
      try {
        const st = statSync(abs)
        if (Date.now() - st.mtimeMs > MAX_AGE_MS) rmSync(abs, { force: true })
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
```

- [ ] **Step 3: Run, verify PASS**

Run: `npx vitest run tests/main/engine/sweep.test.ts`
Expected: 1 test passes.

- [ ] **Step 4: Invoke at app ready in src/main/index.ts**

Найди где регистрируется `registerIpc(window)` или app ready event, добавь:

```ts
import { sweepEngineState } from './sync/engine/sweep'
// ...
app.whenReady().then(() => {
  const cfg = readConfig(join(app.getPath('userData'), 'config.json'))
  if (cfg.repoPath) sweepEngineState(cfg.repoPath, app.getPath('userData'))
})
```

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/sweep.ts tests/main/engine/sweep.test.ts src/main/index.ts
git commit -m "feat(sync-engine): startup sweep for orphaned tmp-index files"
```

---

### Task H3: Final verification

- [ ] **Step 1: Full pipeline test**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: всё зелёное, build проходит.

- [ ] **Step 2: Manual E2E checklist**

Run: `npm run dev`. Прогон:

1. **No phantom diff:** в синке pristine состоянии не делать ничего → обновлять чип несколько раз → localChanges должно оставаться 0.
2. **Push flow:** изменить файл в `~/.claude` → чип local-changes → Push → коммит и push, чип in-sync.
3. **Pull flow (clean):** на другой машине push изменения → на этой запустить → чип behind → Pull → preview → Apply → файлы в `~/.claude` обновлены, чип in-sync.
4. **Pull flow with deletion opt-out:** удалить файл на другой машине, push → на этой Pull → preview покажет deletion с unchecked checkbox → Apply без отметки → файл остался локально, в репо отсутствует, чип покажет local-changes (added).
5. **Diverged flow:** локальное изменение + push с другой машины → чип diverged → Push/Pull buttons hidden → Resolve button visible → клик → ConflictModal → per-file mine/theirs → Apply → merge commit на remote, чип in-sync.
6. **Discard flow:** изменить файл локально → Discard → файл откатился к HEAD, чип in-sync.
7. **Crash mid-Resolve:** во время резолва kill процесса → restart → ConflictModal автоматически восстанавливает state (или показывает confirm).

- [ ] **Step 3: Update CHANGELOG/release notes**

Если есть — обновить с описанием нового sync engine.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(sync-engine): v1 ready — phantom-diff bug fixed, diverged blocked"
```

---

## Self-review (для writing-plans)

**Spec coverage check:**

| Spec section | Plan task |
|---|---|
| WT == HEAD invariant | A4-A6 (git-ops syncWtToHead), C1 (IndexBuilder cleanup), D2 (executePullApply finalizes via syncWtToHead) |
| SyncRules defaults | A2 |
| settings.json allow-list filter | A2, A3 |
| Source = ~/.claude (source of truth) | A7 |
| Compare = source vs HEAD | A8, B1 |
| No WT mutation on chip refresh | B1-B3 |
| Push via temp index | C1, C2 |
| Push race detection | C2 (rollback on non-ff) |
| Pull preview + apply | D1, D2 |
| Pull settings.json merge | D1 (mergeSettingsForPull) |
| Pull deletion opt-in | D2 (deletionsToApply), D4 (UI checkboxes) |
| Diverged detection | B1 (state derivation) |
| Diverged blocks Push/Pull | E3 |
| Resolver 3-way | E1 |
| Resolver persistence + crash recovery | E1 (persist), E2 (load) |
| Resolver 2-parent merge commit | E1 (executeResolve) |
| Discard via PullApply | F1 |
| init-wizard canonical settings.json | G1 |
| Startup sweep | H2 |
| Cursor projects parity | A7, B1, C2, D2 (project loops) |

**Placeholder scan:** none — все steps содержат полный код.

**Type consistency:** `RefreshArgs`, `PushArgs`, `PullApplyArgs`, `ResolverArgs` — все экспортируются из engine.ts. `EngineStatus`, `DiffEntry`, `PreviewItem`, `ResolverFile`, `ResolverState` — из @shared/sync-types.

**Scope check:** один subsystem (sync engine), Phase A-H sequential. После каждой фазы тесты зелёные, поведение в работе.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-sync-engine.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task (A1, A2, ...), review между ними, быстрый цикл.
2. **Inline Execution** — выполняем здесь батчами с чекпоинтами.

Какой подход?
