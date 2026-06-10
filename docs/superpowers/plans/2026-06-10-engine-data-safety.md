# Engine Data Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть дыры потери данных К1–К7 (спек `docs/superpowers/specs/2026-06-10-engine-data-safety-design.md`) и добавить снапшот-слой перед мутациями живых файлов.

**Architecture:** Три новых модуля (`op-lock`, `path-membership`, `safety-snapshot`) + точечные правки движка (`source-enum`, `engine`, `pull-apply`, `resolver`, `cursor-install`, `plugins`, `ipc`). Один in-process мьютекс на все мутирующие операции; единая classify-функция для push/pull-фильтров; явные snapshot-сессии fail-closed.

**Tech Stack:** Electron main (Node 20, TS strict, ESM), vitest, git CLI plumbing. Тесты: `npx vitest run tests/...`. Ветка: `sync-engine` (мы уже на ней, worktree не создавать — правило пользователя).

**Правила выполнения (от пользователя, переопределяют дефолты):**
- Коммит после каждой задачи — да (устоявшийся workflow), **НИКОГДА не добавлять `Co-Authored-By`** или иную подпись Claude.
- Версию/тег/релиз НЕ трогать.
- Push — один раз в конце (Task 12).
- UI-проверка через computer-use/Playwright на этом этапе НЕ выполняется (по workflow пользователя — только на релизе); UI верифицируется юнит-тестами словарей и tsc.

---

### Task 1: Модуль op-lock

**Files:**
- Create: `src/main/sync/engine/op-lock.ts`
- Test: `tests/main/engine/op-lock.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/main/engine/op-lock.test.ts
import { describe, it, expect } from 'vitest'
import { withExclusiveLock, isLocked } from '../../../src/main/sync/engine/op-lock'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('op-lock', () => {
  it('serializes concurrent operations FIFO', async () => {
    const order: string[] = []
    const a = withExclusiveLock('a', async () => { await sleep(30); order.push('a') })
    const b = withExclusiveLock('b', async () => { order.push('b') })
    const c = withExclusiveLock('c', async () => { order.push('c') })
    await Promise.all([a, b, c])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('isLocked is true while an operation runs or queues, false after', async () => {
    expect(isLocked()).toBe(false)
    const p = withExclusiveLock('x', async () => { await sleep(20) })
    expect(isLocked()).toBe(true)
    await p
    expect(isLocked()).toBe(false)
  })

  it('an error in one operation does not break the queue', async () => {
    await expect(withExclusiveLock('bad', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(withExclusiveLock('next', async () => 'ok' as const)).resolves.toBe('ok')
    expect(isLocked()).toBe(false)
  })

  it('returns the operation result', async () => {
    await expect(withExclusiveLock('r', async () => 42)).resolves.toBe(42)
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run tests/main/engine/op-lock.test.ts`
Expected: FAIL — `Cannot find module .../op-lock`

- [ ] **Step 3: Реализация**

```ts
// src/main/sync/engine/op-lock.ts
// Single in-process FIFO mutex for ALL mutating sync operations (engine push/
// pull/discard/resolve, install, init-repo, legacy run-sync). Electron main is
// a single process and the app holds a single-instance lock, so an in-process
// queue is sufficient — no on-disk lock files (those rot after crashes).

let queue: Promise<unknown> = Promise.resolve()
let pending = 0

/** True while any exclusive operation is running or queued. Read-only status
 *  refresh must skip (return the cached snapshot) while this is true. */
export function isLocked(): boolean {
  return pending > 0
}

/** Run `fn` exclusively. Concurrent calls queue FIFO. The opName parameter is
 *  for diagnostics only. */
export function withExclusiveLock<T>(_opName: string, fn: () => Promise<T>): Promise<T> {
  pending++
  const run = queue.then(async () => {
    try {
      return await fn()
    } finally {
      pending--
    }
  })
  // Swallow errors on the chain so one failed op doesn't poison the queue;
  // the caller still gets the rejection from `run`.
  queue = run.then(() => undefined, () => undefined)
  return run
}
```

- [ ] **Step 4: Запустить — зелёный**

Run: `npx vitest run tests/main/engine/op-lock.test.ts`
Expected: PASS (4 теста)

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/op-lock.ts tests/main/engine/op-lock.test.ts
git commit -m "feat(sync-engine): op-lock — FIFO mutex for mutating sync operations"
```

---

### Task 2: Подключить op-lock в IPC, заменить withRunLock, busy-скип refresh

**Files:**
- Modify: `src/main/ipc.ts` (импорты:18; run-sync:102; get/refresh-sync-status:491-529; run-push:565; execute-pull-apply:670; discard:690; run-install:709; resolver-execute:779)
- Modify: `src/main/init-wizard.ts:15,308`
- Modify: `src/main/runner.ts:67-77` (удалить withRunLock)
- Modify: `src/shared/api.ts` (SyncStatus + `busy?: boolean`)
- Modify: `tests/main/runner.test.ts:79-100` (удалить describe withRunLock)
- Modify: `tests/main/ipc.test.ts:4,28,139-140`, `tests/main/init-wizard.test.ts:17` (моки)

- [ ] **Step 1: Обновить runner.ts — удалить withRunLock**

Удалить строки 67–77 (`let running = false` и `export async function withRunLock...`). Из `tests/main/runner.test.ts` удалить весь `describe('withRunLock', ...)` (строки 79–100) и его импорт.

- [ ] **Step 2: ipc.ts — заменить использование**

Строка 18: `import { runCommand } from './runner'` + добавить `import { withExclusiveLock, isLocked } from './sync/engine/op-lock'`.

Строка 102: `return withRunLock(async () => {` → `return withExclusiveLock('run-sync', async () => {`.

`run-push` (строка 573): обернуть вызов:
```ts
    const r = await withExclusiveLock('push', () => executePush({
      // ...аргументы без изменений...
    }))
```
Аналогично `execute-pull-apply` (673): `const r = await withExclusiveLock('pull-apply', () => executePullApply({...}))`; `discard-local-changes` (693): `withExclusiveLock('discard', () => executeDiscard({...}))`; `resolver-execute` (781): `(_e, commitMessage, resolutions) => withExclusiveLock('resolve', () => executeResolveIPC(configPath, userDataDir, commitMessage, resolutions))`; `run-install` (709): обернуть всё тело хендлера: `ipcMain.handle('run-install', (_e, opts: InstallOptions): Promise<RunResult> => withExclusiveLock('install', async () => { ...существующее тело... }))`.

- [ ] **Step 3: ipc.ts — busy-скип статуса**

В начало хендлеров `get-sync-status` (491) и `refresh-sync-status` (517) первой строкой:
```ts
    if (isLocked()) return { ...cachedSyncStatus, busy: true }
```
В `src/shared/api.ts` в тип `SyncStatus` добавить поле `busy?: boolean` (найти `export type SyncStatus`).

- [ ] **Step 4: init-wizard.ts**

Строка 15: `import { runCommand } from './runner'` + `import { withExclusiveLock } from './sync/engine/op-lock'`. Строка 308: `return withRunLock(async () => {` → `return withExclusiveLock('init-repo', async () => {`.

- [ ] **Step 5: Обновить моки тестов**

`tests/main/ipc.test.ts`: мок `withRunLock` (строки 4, 28, 139–140) удалить из мока `./runner`; добавить мок op-lock:
```ts
vi.mock('../../src/main/sync/engine/op-lock', () => ({
  withExclusiveLock: <T,>(_n: string, task: () => Promise<T>) => task(),
  isLocked: () => false,
}))
```
`tests/main/init-wizard.test.ts:17`: из мока runner убрать `withRunLock`, добавить такой же мок op-lock.

- [ ] **Step 6: Прогнать затронутые тесты + tsc**

Run: `npx vitest run tests/main/runner.test.ts tests/main/ipc.test.ts tests/main/init-wizard.test.ts tests/main/engine/op-lock.test.ts && npx tsc --noEmit`
Expected: PASS, tsc без ошибок. Если ipc.test содержал ассерты на вызов withRunLock — заменить на проверку, что хендлер отработал (поведенчески ничего не изменилось: мок выполняет task сразу).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sync-engine): serialize all mutating ops via op-lock, busy-skip status refresh"
```

---

### Task 3: Модуль path-membership (classifyRepoPath)

**Files:**
- Create: `src/main/sync/engine/path-membership.ts`
- Test: `tests/main/engine/path-membership.test.ts`

- [ ] **Step 1: Падающий тест**

```ts
// tests/main/engine/path-membership.test.ts
import { describe, it, expect } from 'vitest'
import { classifyRepoPath, type MembershipCtx } from '../../../src/main/sync/engine/path-membership'
import { encodeClaudeProjectSegment } from '../../../src/main/sync/engine/rules'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
const ctx: MembershipCtx = {
  claudeProjects: [
    { name: 'erp', path: 'C:\\work\\erp', syncMemory: true, syncDotClaude: true },
    { name: 'web', path: 'C:\\work\\web', syncMemory: false, syncDotClaude: false },
  ],
  cursorProjects: [{ name: 'cur1', path: 'C:\\work\\cur1' }],
  syncGlobal: allOn,
}

describe('classifyRepoPath', () => {
  it.each([
    ['claude/CLAUDE.md', 'claude-global', 'CLAUDE.md'],
    ['claude/settings.json', 'claude-global', 'settings.json'],
    ['claude/commands/x.md', 'claude-global', 'commands/x.md'],
    ['claude/skills/s/SKILL.md', 'claude-global', 'skills/s/SKILL.md'],
  ])('%s → ok %s', (repoPath, kind, surfacePath) => {
    const c = classifyRepoPath(repoPath, ctx)
    expect(c).toEqual({ ok: { source: { kind }, surfacePath } })
  })

  it('global toggles → toggle-off', () => {
    const off = { ...ctx, syncGlobal: { ...allOn, commands: false } }
    expect(classifyRepoPath('claude/commands/x.md', off)).toEqual({ skip: 'toggle-off' })
  })

  it('unknown path under claude/ → unknown-path (К4)', () => {
    expect(classifyRepoPath('claude/unknown.txt', ctx)).toEqual({ skip: 'unknown-path' })
    expect(classifyRepoPath('claude/agents/a.md', ctx)).toEqual({ skip: 'unknown-path' })
    expect(classifyRepoPath('claude/projects/erp/sessions/s.jsonl', ctx)).toEqual({ skip: 'unknown-path' })
  })

  it('project memory: registered+on → ok with encoded surfacePath', () => {
    const c = classifyRepoPath('claude/projects/erp/memory/m.md', ctx)
    expect(c).toEqual({
      ok: {
        source: { kind: 'claude-project-memory', projectName: 'erp' },
        surfacePath: `projects/${encodeClaudeProjectSegment('C:\\work\\erp')}/memory/m.md`,
      },
    })
  })

  it('project memory: toggle off → toggle-off; unregistered → unregistered-project', () => {
    expect(classifyRepoPath('claude/projects/web/memory/m.md', ctx)).toEqual({ skip: 'toggle-off' })
    expect(classifyRepoPath('claude/projects/ghost/memory/m.md', ctx)).toEqual({ skip: 'unregistered-project' })
  })

  it('project .claude: registered+on → ok', () => {
    expect(classifyRepoPath('claude/projects/erp/.claude/CLAUDE.md', ctx)).toEqual({
      ok: { source: { kind: 'claude-project-dotclaude', projectName: 'erp' }, surfacePath: '.claude/CLAUDE.md' },
    })
    expect(classifyRepoPath('claude/projects/web/.claude/CLAUDE.md', ctx)).toEqual({ skip: 'toggle-off' })
  })

  it('cursor: registered → ok, unregistered → unregistered-project', () => {
    expect(classifyRepoPath('cursor/projects/cur1/.cursorrules', ctx)).toEqual({
      ok: { source: { kind: 'cursor-project', projectName: 'cur1' }, surfacePath: '.cursorrules' },
    })
    expect(classifyRepoPath('cursor/projects/nope/.cursorrules', ctx)).toEqual({ skip: 'unregistered-project' })
  })

  it('paths outside claude/cursor → unknown-path', () => {
    expect(classifyRepoPath('README.md', ctx)).toEqual({ skip: 'unknown-path' })
  })
})
```

- [ ] **Step 2: Запустить — FAIL (модуля нет)**

Run: `npx vitest run tests/main/engine/path-membership.test.ts`

- [ ] **Step 3: Реализация**

```ts
// src/main/sync/engine/path-membership.ts
// Single source of truth for "does this repo path belong to the sync set".
// Used by BOTH the HEAD filter in refreshStatus and computePullPreview, so
// push and pull can never disagree (К4). Sub-project №2 (manifest) will
// replace the internals of classifyRepoPath without touching its callers.
import type { ClaudeProject, CursorProject, ClaudeGlobalSyncFlags } from '@shared/api'
import type { SourceRef } from '@shared/sync-types'
import { encodeClaudeProjectSegment } from './rules'

export type MembershipCtx = {
  claudeProjects: ClaudeProject[]
  cursorProjects: CursorProject[]
  syncGlobal: ClaudeGlobalSyncFlags
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
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/main/engine/path-membership.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/path-membership.ts tests/main/engine/path-membership.test.ts
git commit -m "feat(sync-engine): path-membership — single classifyRepoPath for push/pull symmetry"
```

---

### Task 4: Переключить engine на classifyRepoPath + foreignPaths (К4)

**Files:**
- Modify: `src/main/sync/engine/engine.ts` (HEAD-фильтр 62-123; pull-парсинг 360-418; surfaceAbsPath 235)
- Modify: `src/shared/sync-types.ts` (EngineStatus + foreignPaths)
- Test: `tests/main/engine/engine-foreign-paths.test.ts` (новый)

- [ ] **Step 1: Падающий интеграционный тест**

```ts
// tests/main/engine/engine-foreign-paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { refreshStatus, computePullPreview, executePullApply } from '../../../src/main/sync/engine/engine'
import { initEmptyRepo } from '../../fixtures/sync-roundtrip'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
let root: string

function git(repo: string, args: string[]): void {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-foreign-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function baseArgs(repoPath: string, home: string) {
  return {
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, syncGlobal: allOn,
  }
}

describe('foreign paths under claude/ (К4)', () => {
  it('refreshStatus: unknown HEAD path is foreign, not phantom-deleted', async () => {
    const repoPath = join(root, 'repo')
    initEmptyRepo(repoPath)
    const home = join(root, 'home', '.claude')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), 'rules\n')
    // HEAD: tracked CLAUDE.md (same as source) + foreign unknown.txt
    mkdirSync(join(repoPath, 'claude'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'rules\n')
    writeFileSync(join(repoPath, 'claude', 'unknown.txt'), 'stray\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-m', 'seed'])

    const status = await refreshStatus({ ...baseArgs(repoPath, home), doFetch: false })
    expect(status.diffs.find((d) => d.repoPath === 'claude/unknown.txt')).toBeUndefined()
    expect(status.localChanges).toBe(0)
    expect(status.foreignPaths).toContain('claude/unknown.txt')
  })

  it('pull: unknown remote path is not applied to ~/.claude and not phantom-deleted after', async () => {
    const repoPath = join(root, 'repo')
    initEmptyRepo(repoPath)
    const home = join(root, 'home', '.claude')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), 'v1\n')
    mkdirSync(join(repoPath, 'claude'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v1\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-m', 'seed'])
    // bare origin + ahead commit with foreign file and a tracked change
    const bare = join(root, 'origin.git')
    git(repoPath, ['clone', '--bare', repoPath, bare])
    git(repoPath, ['remote', 'add', 'origin', bare])
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v2\n')
    writeFileSync(join(repoPath, 'claude', 'unknown2.txt'), 'stray\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-m', 'remote change'])
    git(repoPath, ['push', 'origin', 'main'])
    git(repoPath, ['reset', '--hard', 'HEAD~1'])

    const args = { ...baseArgs(repoPath, home), deletionsToApply: [] as string[] }
    const preview = await computePullPreview(args)
    expect(preview.kind).toBe('preview')
    if (preview.kind !== 'preview') return
    expect(preview.items.map((i) => i.repoPath)).toEqual(['claude/CLAUDE.md'])

    const r = await executePullApply(args)
    expect(r.kind).toBe('ok')
    expect(existsSync(join(home, 'unknown2.txt'))).toBe(false)
    // after pull HEAD contains unknown2.txt — it must be foreign, not deleted
    const status = await refreshStatus({ ...baseArgs(repoPath, home), doFetch: false })
    expect(status.localChanges).toBe(0)
    expect(status.foreignPaths).toContain('claude/unknown2.txt')
  })
})
```

Примечание: в Task 8 тип `PullApplyArgs` получит обязательное поле `userDataDir` — тогда в этот тест добавить `userDataDir: join(root, 'ud')` (Task 8, Step 8 это предусматривает).

- [ ] **Step 2: Запустить — FAIL** (foreignPaths нет; unknown.txt сейчас даёт phantom deleted)

Run: `npx vitest run tests/main/engine/engine-foreign-paths.test.ts`

- [ ] **Step 3: Типы**

`src/shared/sync-types.ts`, в `EngineStatus` после `fetchedAt`:
```ts
  /** Paths present under claude/ in HEAD that match no sync rule. Never
   *  deleted, never pulled — surfaced as a warning only. */
  foreignPaths: string[]
```

- [ ] **Step 4: engine.ts — refreshStatus через classify**

Импорт: `import { classifyRepoPath, type MembershipCtx } from './path-membership'`.

В `EMPTY_STATUS` добавить `foreignPaths: []`.

В начале `refreshStatus` после guard'а:
```ts
  const membershipCtx: MembershipCtx = {
    claudeProjects: args.claudeProjects,
    cursorProjects: args.cursorProjects,
    syncGlobal: args.syncGlobal,
  }
  const foreignPaths: string[] = []
```

Заменить блок фильтрации HEAD (строки 63–84) на:
```ts
    const headEntries = await enumHead(repoPath, 'claude/', 'claude/')
    const filteredHead: typeof headEntries = []
    for (const h of headEntries) {
      const c = classifyRepoPath(h.repoPath, membershipCtx)
      if ('ok' in c) filteredHead.push(h)
      else if (c.skip === 'unknown-path') foreignPaths.push(h.repoPath)
      // toggle-off / unregistered-project: excluded symmetrically (≠ deletion)
    }
```

Заменить `refForRepoPath` (99–107) на:
```ts
    function refForRepoPath(p: string): SourceRef | null {
      const c = classifyRepoPath(p, membershipCtx)
      return 'ok' in c ? c.ok.source : null
    }
```
(`refKeyForRepoPath` остаётся как есть — он строится поверх `refForRepoPath`.)

В `return` финального статуса добавить `foreignPaths`.

- [ ] **Step 5: engine.ts — computePullPreview через classify**

Заменить блок разбора пути (строки 360–393, от `let surfacePath: string` до закрытия cursor-ветки) на:
```ts
    const c = classifyRepoPath(path, {
      claudeProjects: args.claudeProjects,
      cursorProjects: args.cursorProjects,
      syncGlobal: args.syncGlobal,
    })
    if (!('ok' in c)) continue // unknown-path / toggle-off / unregistered — symmetric with push
    const source = c.ok.source
    const surfacePath = c.ok.surfacePath
```
Дальнейший маппинг `srcAbs` (строки 406–418) упростить через существующий helper — заменить на:
```ts
    const srcAbs = surfaceAbsPath(args, { source, surfacePath })
    if (!srcAbs) continue
```
и поменять сигнатуру `surfaceAbsPath` (строка 235): `function surfaceAbsPath(args: RefreshArgs, d: Pick<DiffEntry, 'source' | 'surfacePath'>): string | null` (тело без изменений).

Удалить ставший неиспользуемым импорт `encodeClaudeProjectSegment` из engine.ts, если на него больше нет ссылок (проверить grep'ом).

- [ ] **Step 6: Прогнать тесты движка + tsc**

Run: `npx vitest run tests/main/engine/ && npx tsc --noEmit`
Expected: PASS, включая новый файл и существующие regression-тесты (`regression-no-phantom-after-pull`, `engine-pull`, `engine-push`, `engine-refresh`). Если `engine-refresh`/`sync-status` тесты ассертят форму EngineStatus — добавить `foreignPaths: []` в ожидания.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(sync-engine): symmetric push/pull membership + foreignPaths instead of phantom deletions (K4)"
```

---

### Task 5: walk-ошибки → unreadable, не deleted (К2)

**Files:**
- Modify: `src/main/sync/engine/source-enum.ts`
- Modify: `src/main/sync/engine/engine.ts` (применение failed-префиксов)
- Test: `tests/main/engine/source-enum-failed.test.ts` (новый), `tests/main/engine/source-enum.test.ts` (расширить ожидания EnumResult)

- [ ] **Step 1: Падающий тест**

```ts
// tests/main/engine/source-enum-failed.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const failSet = vi.hoisted(() => ({ dirs: new Set<string>() }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readdirSync: ((p: unknown, ...rest: unknown[]) => {
      if (failSet.dirs.has(String(p))) {
        const e = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
        e.code = 'EPERM'
        throw e
      }
      return (actual.readdirSync as (...a: unknown[]) => unknown)(p, ...rest)
    }) as typeof actual.readdirSync,
  }
})

import { enumClaudeSource } from '../../../src/main/sync/engine/source-enum'
import { repoPathUnderFailed } from '../../../src/main/sync/engine/source-enum'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-failed-')); failSet.dirs.clear() })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('walk failures → failed prefixes (К2)', () => {
  it('unreadable subdirectory lands in failed, not silently dropped', async () => {
    const home = join(root, '.claude')
    mkdirSync(join(home, 'commands'), { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), 'x')
    writeFileSync(join(home, 'commands', 'a.md'), 'a')
    failSet.dirs.add(join(home, 'commands'))

    const res = await enumClaudeSource(home, [], allOn)
    expect(res.entries.map((e) => e.repoPath)).toEqual(['claude/CLAUDE.md'])
    expect(res.failed).toContain('claude/commands')
  })

  it('whole root unreadable → failed covers everything', async () => {
    const home = join(root, '.claude')
    mkdirSync(home, { recursive: true })
    failSet.dirs.add(home)
    const res = await enumClaudeSource(home, [], allOn)
    expect(res.entries).toEqual([])
    expect(res.failed).toEqual(['claude/'])
  })
})

describe('repoPathUnderFailed', () => {
  it('matches exact path and prefix', () => {
    expect(repoPathUnderFailed('claude/commands/a.md', ['claude/commands'])).toBe(true)
    expect(repoPathUnderFailed('claude/commands', ['claude/commands'])).toBe(true)
    expect(repoPathUnderFailed('claude/commandsX/a.md', ['claude/commands'])).toBe(false)
    expect(repoPathUnderFailed('claude/anything', ['claude/'])).toBe(true)
    expect(repoPathUnderFailed('claude/anything', [])).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить — FAIL** (`failed`/`repoPathUnderFailed` не существуют)

Run: `npx vitest run tests/main/engine/source-enum-failed.test.ts`

- [ ] **Step 3: source-enum.ts — реализация**

`EnumResult` дополнить:
```ts
export type EnumResult = {
  entries: FileEntry[]
  unreadable: string[]
  /** repoPath-prefixes whose directory could not be enumerated (readdir/lstat/
   *  stat failure). HEAD files under these prefixes must be treated as
   *  'unreadable', never 'deleted'. A trailing-slash entry covers a subtree;
   *  'claude/' covers the whole surface. */
  failed: string[]
}
```

`walk` переписать (возврат boolean больше не нужен):
```ts
function walk(
  rootAbs: string,
  prefixParts: string[],
  cb: (relPosix: string, abs: string) => void,
  failedRel: string[],
): void {
  if (!existsSync(rootAbs)) return // absent ≠ unreadable; caller decides
  let entries: string[]
  try { entries = readdirSync(rootAbs) } catch {
    failedRel.push(prefixParts.length ? posix.join(...prefixParts) : '')
    return
  }
  for (const name of entries) {
    const abs = join(rootAbs, name)
    let lst
    try { lst = lstatSync(abs) } catch { failedRel.push(posix.join(...prefixParts, name)); continue }
    if (lst.isSymbolicLink() && !existsSync(abs)) continue
    let st
    try { st = statSync(abs) } catch { failedRel.push(posix.join(...prefixParts, name)); continue }
    if (st.isDirectory()) {
      walk(abs, [...prefixParts, name], cb, failedRel)
    } else if (st.isFile()) {
      cb(posix.join(...prefixParts, name), abs)
    }
  }
}
```

В `enumClaudeSource` собрать и перевести в repo-простанство:
```ts
  const failedRel: string[] = []
  walk(claudePath, [], (rel, abs) => { /* существующий cb без изменений */ }, failedRel)
  const failed: string[] = []
  for (const rel of failedRel) {
    if (rel === '') { failed.push('claude/'); continue }
    if (rel === 'projects') { failed.push('claude/projects/'); continue }
    const m = rel.match(/^projects\/([^/]+)(\/.*)?$/)
    if (m) {
      const proj = idx.get(m[1]!)
      if (!proj || !proj.syncMemory) continue // untracked subtree — irrelevant
      failed.push(`claude/projects/${proj.name}${m[2] ?? ''}`)
      continue
    }
    if (isClaudePathIgnored(rel)) continue
    failed.push(`claude/${rel}`)
  }
  return { entries: out, unreadable, failed }
```

В `enumClaudeProjectDotClaudeSource`:
```ts
  const failedRel: string[] = []
  walk(root, [], (rel, abs) => { /* существующий cb */ }, failedRel)
  const failed: string[] = []
  for (const rel of failedRel) {
    if (rel === '') { failed.push(`claude/projects/${projectName}/.claude/`); continue }
    if (!isProjectDotClaudePathSynced(rel) && rel.includes('/')) {
      // a failed nested dir under an ignored top — irrelevant
      continue
    }
    failed.push(`claude/projects/${projectName}/.claude/${rel}`)
  }
  return { entries: out, unreadable, failed }
```

В `enumCursorProjectSource` аналогично: `rel === '' → cursor/projects/${projectName}/`, иначе `cursor/projects/${projectName}/${rel}`.

Добавить экспорт чистого матчера:
```ts
/** True when repoPath is exactly a failed path or lies under a failed prefix. */
export function repoPathUnderFailed(repoPath: string, failed: string[]): boolean {
  return failed.some((f) => {
    if (f.endsWith('/')) return repoPath.startsWith(f)
    return repoPath === f || repoPath.startsWith(f + '/')
  })
}
```

- [ ] **Step 4: engine.ts — применить failed к HEAD**

Импортировать `repoPathUnderFailed` из `./source-enum`. В `refreshStatus`, в Claude-секции: собрать `const dotFailed: string[] = []`, в цикле по проектам `dotFailed.push(...dotRes.failed)`. После построения `filteredHead` добавить:
```ts
    for (const h of filteredHead) {
      const c = classifyRepoPath(h.repoPath, membershipCtx)
      if (!('ok' in c)) continue
      const kind = c.ok.source.kind
      if ((kind === 'claude-global' || kind === 'claude-project-memory') &&
          repoPathUnderFailed(h.repoPath, globalRes.failed)) unreadableSet.add(h.repoPath)
      if (kind === 'claude-project-dotclaude' &&
          repoPathUnderFailed(h.repoPath, dotFailed)) unreadableSet.add(h.repoPath)
    }
```
В Cursor-цикле передать failed в compare:
```ts
    const cursorUnreadable = new Set(res.unreadable)
    for (const h of headEntries) {
      if (repoPathUnderFailed(h.repoPath, res.failed)) cursorUnreadable.add(h.repoPath)
    }
    const part = compare(src, res.entries, headEntries.map((h) => ({ ...h, sha: h.sha1 })), [], cursorUnreadable)
```

- [ ] **Step 5: Интеграционная проверка через refreshStatus**

Добавить в `tests/main/engine/source-enum-failed.test.ts` тест: репо с `claude/commands/a.md` в HEAD, источник с заблокированной (failSet) папкой `commands` → `refreshStatus` даёт для `claude/commands/a.md` статус `unreadable`, `localChanges === 0`:
```ts
import { refreshStatus } from '../../../src/main/sync/engine/engine'
import { initEmptyRepo } from '../../fixtures/sync-roundtrip'
import { spawnSync } from 'node:child_process'

it('refreshStatus: HEAD files under failed dir are unreadable, not deleted', async () => {
  const repoPath = join(root, 'repo')
  initEmptyRepo(repoPath)
  const home = join(root, '.claude')
  mkdirSync(join(home, 'commands'), { recursive: true })
  writeFileSync(join(home, 'commands', 'a.md'), 'a')
  mkdirSync(join(repoPath, 'claude', 'commands'), { recursive: true })
  writeFileSync(join(repoPath, 'claude', 'commands', 'a.md'), 'a')
  spawnSync('git', ['-C', repoPath, 'add', '-A'], { encoding: 'utf8' })
  spawnSync('git', ['-C', repoPath, 'commit', '-m', 'seed'], { encoding: 'utf8' })
  failSet.dirs.add(join(home, 'commands'))

  const status = await refreshStatus({
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, doFetch: false, syncGlobal: allOn,
  })
  const entry = status.diffs.find((d) => d.repoPath === 'claude/commands/a.md')
  expect(entry?.status).toBe('unreadable')
  expect(status.localChanges).toBe(0)
})
```

- [ ] **Step 6: Прогнать всё движковое + tsc**

Run: `npx vitest run tests/main/engine/ && npx tsc --noEmit`
Expected: PASS. `source-enum.test.ts` может ассертить форму результата — добавить `failed: []` где нужно.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(sync-engine): failed directory/stat reads surface as unreadable, never deleted (K2)"
```

---

### Task 6: Pull не перетирает нечитаемые локальные файлы (К1)

**Files:**
- Modify: `src/shared/sync-types.ts` (PreviewItem.status)
- Modify: `src/main/sync/engine/engine.ts` (computePullPreview, executePullApply)
- Modify: `src/main/sync/engine/pull-apply.ts` (mergeSettingsForPull → Buffer | null)
- Modify: `tests/fixtures/sync-roundtrip.ts:248,254` (`?? blob`)
- Test: `tests/main/engine/pull-skip-unreadable.test.ts` (новый), `tests/main/engine/pull-apply.test.ts` (merge null-case)

- [ ] **Step 1: Падающие тесты**

```ts
// tests/main/engine/pull-skip-unreadable.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computePullPreview, executePullApply } from '../../../src/main/sync/engine/engine'
import { initEmptyRepo } from '../../fixtures/sync-roundtrip'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-skip-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function git(repo: string, args: string[]): void {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

it('pull skips locally-unparseable settings.json, preserves env, applies the rest', async () => {
  const repoPath = join(root, 'repo')
  initEmptyRepo(repoPath)
  const home = join(root, '.claude')
  mkdirSync(home, { recursive: true })
  // HEAD = canonical settings + CLAUDE.md v1
  mkdirSync(join(repoPath, 'claude'), { recursive: true })
  writeFileSync(join(repoPath, 'claude', 'settings.json'), JSON.stringify({ theme: 'dark' }, null, 2))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v1\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-m', 'seed'])
  const bare = join(root, 'origin.git')
  git(repoPath, ['clone', '--bare', repoPath, bare])
  git(repoPath, ['remote', 'add', 'origin', bare])
  // remote ahead: settings theme=light, CLAUDE.md v2
  writeFileSync(join(repoPath, 'claude', 'settings.json'), JSON.stringify({ theme: 'light' }, null, 2))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v2\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-m', 'remote'])
  git(repoPath, ['push', 'origin', 'main']); git(repoPath, ['reset', '--hard', 'HEAD~1'])
  // local: CLAUDE.md == HEAD, settings.json BROKEN mid-edit (with secrets)
  writeFileSync(join(home, 'CLAUDE.md'), 'v1\n')
  const broken = '{ "theme": "dark", "env": { "API_KEY": "sec' // truncated json
  writeFileSync(join(home, 'settings.json'), broken)

  // NB: после Task 8 в args добавится userDataDir (Task 8, Step 8)
  const args = {
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, syncGlobal: allOn, deletionsToApply: [] as string[],
  }
  const preview = await computePullPreview(args)
  expect(preview.kind).toBe('preview')
  if (preview.kind !== 'preview') return
  const settingsItem = preview.items.find((i) => i.repoPath === 'claude/settings.json')
  expect(settingsItem?.status).toBe('skipped-unreadable')

  const r = await executePullApply(args)
  expect(r.kind).toBe('ok')
  // broken local settings untouched — env secret intact
  expect(readFileSync(join(home, 'settings.json'), 'utf8')).toBe(broken)
  // the rest applied, HEAD fast-forwarded
  expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe('v2\n')
  const head = spawnSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  const remote = spawnSync('git', ['-C', repoPath, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).stdout.trim()
  expect(head).toBe(remote)
})
```

В `tests/main/engine/pull-apply.test.ts` добавить:
```ts
it('mergeSettingsForPull returns null for unparseable current source (skip, not overwrite)', () => {
  const head = Buffer.from(JSON.stringify({ theme: 'light' }), 'utf8')
  expect(mergeSettingsForPull(head, Buffer.from('{ broken', 'utf8'))).toBeNull()
})
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/main/engine/pull-skip-unreadable.test.ts tests/main/engine/pull-apply.test.ts`

- [ ] **Step 3: Типы**

`src/shared/sync-types.ts`:
```ts
export type PullItemStatus = DiffStatus | 'skipped-unreadable'

export type PreviewItem = Omit<DiffEntry, 'status'> & {
  status: PullItemStatus
  /** Raw file content from origin/main, ready to write to source. */
  newContent?: Buffer
  /** Current source content for "before" view, when available. */
  currentContent?: Buffer
}
```

- [ ] **Step 4: pull-apply.ts — merge возвращает null при битом локальном файле**

```ts
export function mergeSettingsForPull(headBlob: Buffer, currentSrc: Buffer | null): Buffer | null {
  const newParsed = JSON.parse(headBlob.toString('utf8')) as Record<string, unknown>
  if (currentSrc === null) return headBlob
  let currentParsed: Record<string, unknown>
  try {
    currentParsed = JSON.parse(currentSrc.toString('utf8')) as Record<string, unknown>
  } catch {
    // Local settings.json is unreadable mid-edit — overwriting it would
    // destroy env secrets and local edits. Skip; it syncs once it parses.
    return null
  }
  // ...остальное без изменений...
}
```
Обновить doc-комментарий функции. В `tests/fixtures/sync-roundtrip.ts` строки 248 и 254: `toWrite = mergeSettingsForPull(blob, null) ?? blob`.

- [ ] **Step 5: engine.ts — пометка и скип**

В `computePullPreview` после получения `status`:
```ts
  const unreadableNow = new Set(
    status.diffs.filter((d) => d.status === 'unreadable').map((d) => d.repoPath))
```
При формировании item: после вычисления `st`:
```ts
    const finalStatus: PreviewItem['status'] = unreadableNow.has(path) ? 'skipped-unreadable' : st
```
и использовать `finalStatus` в `items.push({ ..., status: finalStatus, ... })`. Для `skipped-unreadable` не читать `newContent` не нужно — оставить как есть (UI может показывать diff), но проще: читать только когда `finalStatus !== 'deleted'` (текущая логика по `st` сохраняется).

В `executePullApply` в начале цикла по items:
```ts
    if (item.status === 'skipped-unreadable') continue
```
и в settings-ветке:
```ts
      const merged = mergeSettingsForPull(item.newContent, currentSrc)
      if (merged === null) continue // unreadable local settings — skip, never overwrite
      toWrite = merged
```

- [ ] **Step 6: Прогнать + tsc**

Run: `npx vitest run tests/main/engine/ && npx tsc --noEmit`
Expected: PASS (включая sync-roundtrip).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(sync-engine): pull never overwrites locally-unreadable files; broken settings.json keeps env (K1)"
```

---

### Task 7: Модуль safety-snapshot

**Files:**
- Create: `src/main/sync/engine/safety-snapshot.ts`
- Test: `tests/main/engine/safety-snapshot.test.ts`

- [ ] **Step 1: Падающий тест**

```ts
// tests/main/engine/safety-snapshot.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beginSnapshot, sweepSnapshots } from '../../../src/main/sync/engine/safety-snapshot'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-snap-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('safety-snapshot', () => {
  it('preserve copies file content and records manifest with original path', () => {
    const ud = join(root, 'ud')
    const target = join(root, 'live', 'CLAUDE.md')
    mkdirSync(join(root, 'live'), { recursive: true })
    writeFileSync(target, 'precious')
    const s = beginSnapshot(ud, 'pull-apply')
    s.preserve(target)
    s.commit()
    const sessions = readdirSync(join(ud, 'safety-snapshots'))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toContain('pull-apply')
    const dir = join(ud, 'safety-snapshots', sessions[0]!)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.op).toBe('pull-apply')
    expect(manifest.done).toBe(true)
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0].original).toBe(target)
    expect(readFileSync(manifest.entries[0].stored, 'utf8')).toBe('precious')
  })

  it('preserve of a missing file is a no-op; empty session creates no dir', () => {
    const ud = join(root, 'ud')
    const s = beginSnapshot(ud, 'discard')
    s.preserve(join(root, 'nope.md'))
    s.commit()
    expect(existsSync(join(ud, 'safety-snapshots'))).toBe(false)
  })

  it('preserve throws when snapshot dir cannot be created (fail-closed)', () => {
    const ud = join(root, 'ud-file')
    writeFileSync(ud, 'i am a file, not a dir')
    const target = join(root, 'x.md')
    writeFileSync(target, 'x')
    const s = beginSnapshot(ud, 'op')
    expect(() => s.preserve(target)).toThrow()
  })

  it('sweep removes sessions older than 30 days but always keeps 10 newest', () => {
    const ud = join(root, 'ud')
    const base = join(ud, 'safety-snapshots')
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    for (let i = 0; i < 13; i++) {
      const dir = join(base, `2026-01-0${i < 9 ? i + 1 : 9}T00-00-0${i}-op${i}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'manifest.json'), '{}')
      utimesSync(dir, old, old) // all 13 are "older than 30 days"
    }
    sweepSnapshots(ud)
    const left = readdirSync(base)
    expect(left).toHaveLength(10) // min-keep wins over age
  })

  it('sweep keeps young sessions regardless of count', () => {
    const ud = join(root, 'ud')
    const base = join(ud, 'safety-snapshots')
    for (let i = 0; i < 12; i++) {
      const dir = join(base, `2026-06-01T00-00-${String(i).padStart(2, '0')}-op`)
      mkdirSync(dir, { recursive: true })
    }
    sweepSnapshots(ud)
    expect(readdirSync(base)).toHaveLength(12) // nothing is old → nothing removed
  })
})
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/main/engine/safety-snapshot.test.ts`

- [ ] **Step 3: Реализация**

```ts
// src/main/sync/engine/safety-snapshot.ts
// Mechanical last line of defense: before ANY mutation of live user files
// (pull-apply, discard, resolve, cursor-install, plugin settings write) the
// operation preserves the files it is about to overwrite/delete into
// <userData>/safety-snapshots/<ts>-<op>/. Fail-closed: a preserve() error
// must abort the operation BEFORE the first mutation.
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'

const SNAP_DIR = 'safety-snapshots'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MIN_KEEP = 10

type SnapshotEntry = { original: string; stored: string; size: number; sha1: string }

export type SnapshotSession = {
  /** Copy current content of absPath into the session. Missing file → no-op.
   *  Throws on write failure — callers must NOT have mutated anything yet. */
  preserve(absPath: string): void
  /** Mark the session complete (manifest.done = true). */
  commit(): void
  readonly dir: string
}

export function beginSnapshot(userDataDir: string, opName: string): SnapshotSession {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(userDataDir, SNAP_DIR, `${ts}-${opName}`)
  const entries: SnapshotEntry[] = []
  let n = 0
  let created = false
  const writeManifest = (done: boolean): void => {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ op: opName, done, entries }, null, 2))
  }
  return {
    dir,
    preserve(absPath: string): void {
      if (!existsSync(absPath)) return
      const content = readFileSync(absPath)
      if (!created) {
        mkdirSync(join(dir, 'files'), { recursive: true })
        created = true
      }
      const stored = join(dir, 'files', `${n++}-${basename(absPath)}`)
      writeFileSync(stored, content)
      entries.push({
        original: absPath,
        stored,
        size: content.length,
        sha1: createHash('sha1').update(content).digest('hex'),
      })
      writeManifest(false) // manifest survives a crash mid-operation
    },
    commit(): void {
      if (!created) return // nothing preserved — no dir, nothing to mark
      writeManifest(true)
    },
  }
}

/** Rotation: delete sessions older than 30 days, but always keep the 10
 *  newest regardless of age. Called from sweepEngineState on app start. */
export function sweepSnapshots(userDataDir: string): void {
  const base = join(userDataDir, SNAP_DIR)
  if (!existsSync(base)) return
  let names: string[]
  try { names = readdirSync(base) } catch { return }
  // ISO timestamps sort lexicographically — newest last.
  names.sort()
  const candidates = names.slice(0, Math.max(0, names.length - MIN_KEEP))
  for (const name of candidates) {
    const abs = join(base, name)
    try {
      const st = statSync(abs)
      if (Date.now() - st.mtimeMs > MAX_AGE_MS) rmSync(abs, { recursive: true, force: true })
    } catch { /* best-effort */ }
  }
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/main/engine/safety-snapshot.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/main/sync/engine/safety-snapshot.ts tests/main/engine/safety-snapshot.test.ts
git commit -m "feat(sync-engine): safety-snapshot sessions with 30d/min-10 rotation"
```

---

### Task 8: Снапшоты во всех мутирующих операциях (К6, К7)

**Files:**
- Modify: `src/main/sync/engine/engine.ts` (executePullApply, executeDiscard)
- Modify: `src/main/sync/engine/resolver.ts` (executeResolve)
- Modify: `src/main/sync/engine/sweep.ts` (вызвать sweepSnapshots; параметр `_userDataDir` стал используемым)
- Modify: `src/main/sync/cursor-install.ts` (preserve перед перезаписью)
- Modify: `src/main/plugins.ts` (applyChanges + userDataDir)
- Modify: `src/main/ipc.ts` (передать userDataDir в 4 вызова)
- Modify: `src/main/conflict.ts` (если executeResolveIPC прокидывает args — userDataDir уже там)
- Tests: `tests/main/engine/engine-pull.test.ts`, `engine-discard.test.ts`, `resolver.test.ts`, `tests/main/sync-cursor-install.test.ts`, `tests/main/plugins.test.ts` — добавить userDataDir + ассерты снапшота

- [ ] **Step 1: Падающий тест (pull создаёт снапшот)**

Добавить в `tests/main/engine/pull-skip-unreadable.test.ts` (там уже есть полный сетап):
```ts
it('executePullApply preserves overwritten files in a snapshot session', async () => {
  // сетап как в первом тесте файла, но settings.json локально валиден и НЕ изменён
  // (изменён только CLAUDE.md удалённо; локальный CLAUDE.md == HEAD)
  // ... повторить сетап repo/bare/home с CLAUDE.md v1→v2 ...
  const ud = join(root, 'ud')
  const args = {
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, syncGlobal: allOn, deletionsToApply: [] as string[], userDataDir: ud,
  }
  const r = await executePullApply(args)
  expect(r.kind).toBe('ok')
  const sessions = readdirSync(join(ud, 'safety-snapshots'))
  expect(sessions).toHaveLength(1)
  const manifest = JSON.parse(readFileSync(
    join(ud, 'safety-snapshots', sessions[0]!, 'manifest.json'), 'utf8'))
  expect(manifest.entries.map((e: { original: string }) => e.original)).toContain(join(home, 'CLAUDE.md'))
  expect(readFileSync(manifest.entries[0].stored, 'utf8')).toBe('v1\n') // pre-pull content
})
```
(Сетап скопировать из первого теста файла; выделить в локальную helper-функцию `setupAheadRepo()` в этом же файле, чтобы не дублировать.)

- [ ] **Step 2: Запустить — FAIL** (userDataDir не в типе, снапшота нет)

Run: `npx vitest run tests/main/engine/pull-skip-unreadable.test.ts`

- [ ] **Step 3: engine.ts — pull и discard**

Импорт: `import { beginSnapshot } from './safety-snapshot'`.

Типы аргументов:
```ts
export type PullApplyArgs = RefreshArgs & { deletionsToApply: string[]; userDataDir: string }
export async function executeDiscard(
  args: RefreshArgs & { deleteAdded?: boolean; userDataDir: string },
): ...
```

`executePullApply` — двухфазная структура (preserve всё → потом мутации), тело цикла заменить:
```ts
  const deletionsSet = new Set(args.deletionsToApply)
  type Planned = { abs: string; item: (typeof preview.items)[number] }
  const planned: Planned[] = []
  for (const item of preview.items) {
    if (item.status === 'skipped-unreadable') continue
    const abs = surfaceAbsPath(args, item)
    if (!abs) continue // unregistered project — skip silently
    if (item.status === 'deleted') {
      if (deletionsSet.has(item.repoPath)) planned.push({ abs, item })
      continue
    }
    if (item.newContent === undefined) continue
    planned.push({ abs, item })
  }

  try {
    const session = beginSnapshot(args.userDataDir, 'pull-apply')
    for (const p of planned) session.preserve(p.abs) // fail-closed: throws BEFORE mutations

    for (const { abs, item } of planned) {
      if (item.status === 'deleted') {
        await applyToSource(abs, null)
        continue
      }
      let toWrite = item.newContent!
      const isGlobalSettings =
        item.source.kind === 'claude-global' && item.surfacePath === 'settings.json'
      const isProjectSettings =
        item.source.kind === 'claude-project-dotclaude' && item.surfacePath === '.claude/settings.json'
      if (isGlobalSettings || isProjectSettings) {
        const merged = mergeSettingsForPull(item.newContent!, readSourceIfExists(abs))
        if (merged === null) continue
        toWrite = merged
      }
      await applyToSource(abs, toWrite)
    }
    session.commit()
  } catch (e) {
    return { kind: 'error', message: `snapshot/apply failed: ${(e as Error).message}` }
  }
```
(ff HEAD + syncWtToHead остаются после try/catch только при успехе — перенести их ВНУТРЬ try после `session.commit()`.)

`executeDiscard` — так же: собрать planned (added-к-удалению при deleteAdded, modified/deleted-к-восстановлению), `beginSnapshot(args.userDataDir, 'discard')`, preserve всех abs, затем существующие мутации; обернуть в try/catch → `{ kind: 'error' }`.

- [ ] **Step 4: resolver.ts — preserve перед записью**

В `executeResolve` перед циклом записи (строка 189): сначала пройти `resolutions.files`, вычислить surfaceAbs (существующая логика), собрать в массив `targets: Array<{ f: ResolverFile; abs: string }>`; затем:
```ts
    const session = beginSnapshot(args.userDataDir, 'resolve')
    for (const t of targets) session.preserve(t.abs)
```
и только потом цикл `applyToSource`. После успешного push — `session.commit()`. Импорт `beginSnapshot`.

- [ ] **Step 5: cursor-install.ts — preserve перетираемых**

```ts
import type { SnapshotSession } from './engine/safety-snapshot'
import { beginSnapshot } from './engine/safety-snapshot'
import { readFileSync } from 'node:fs'

function syncDirCopy(src: string, dst: string, session: SnapshotSession): void {
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (IGNORED_NAME.test(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    const stat = statSync(s)
    if (stat.isDirectory()) syncDirCopy(s, d, session)
    else {
      if (existsSync(d) && !readFileSync(d).equals(readFileSync(s))) session.preserve(d)
      cpSync(s, d)
    }
  }
}

function copyFileIfExists(src: string, dst: string, session: SnapshotSession): void {
  if (!existsSync(src)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  if (existsSync(dst) && !readFileSync(dst).equals(readFileSync(src))) session.preserve(dst)
  cpSync(src, dst)
}
```
`installCursorProject(repoPath, project, session, emit?)`, `installCursorProjects(repoPath, projects, userDataDir, emit?)`:
```ts
export function installCursorProjects(
  repoPath: string,
  projects: CursorProject[],
  userDataDir: string,
  emit?: (l: LogLine) => void,
): void {
  const session = beginSnapshot(userDataDir, 'cursor-install')
  for (const p of projects) installCursorProject(repoPath, p, session, emit)
  session.commit()
}
```

- [ ] **Step 6: plugins.ts — preserve settings.json**

`applyChanges(settingsPath: string, changes: ApplyPluginChanges, userDataDir: string)`; перед атомарной записью:
```ts
  try {
    const session = beginSnapshot(userDataDir, 'plugins-apply')
    session.preserve(settingsPath)
    const tmp = `${settingsPath}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, settingsPath)
    session.commit()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Write failed: ${(e as Error).message}` }
  }
```
Импорт `beginSnapshot` из `./sync/engine/safety-snapshot`.

- [ ] **Step 7: ipc.ts + sweep.ts + conflict.ts**

ipc.ts: в вызовы добавить `userDataDir`:
- `execute-pull-apply` → `executePullApply({ ..., userDataDir })`
- `discard-local-changes` → `executeDiscard({ ..., userDataDir })`
- `run-install` → `installCursorProjects(repoPath, selected, userDataDir, emit)`
- `apply-plugin-changes` → `applyChanges(settingsPath, changes, userDataDir)` (получить `app.getPath('userData')` — переменная `userDataDir` объявлена ниже по файлу, строка 356: перенести её объявление выше, до plugin-хендлеров).

`conflict.ts`: убедиться, что `executeResolveIPC` передаёт `userDataDir` в args резолвера (он уже в `ResolverArgs` — проверить и оставить).

`sweep.ts`:
```ts
import { sweepSnapshots } from './safety-snapshot'
export function sweepEngineState(repoPath: string, userDataDir: string): void {
  sweepSnapshots(userDataDir)
  // ...существующий tmp-index sweep...
}
```
(переименовать `_userDataDir` → `userDataDir`).

- [ ] **Step 8: Обновить существующие тесты**

Все вызовы `executePullApply`/`executeDiscard` в `tests/main/engine/*.test.ts` — добавить `userDataDir: <tmp>`; `installCursorProjects` в `tests/main/sync-cursor-install.test.ts` — добавить третий аргумент; `applyChanges` в `tests/main/plugins.test.ts` — добавить третий аргумент. В cursor-install-тест добавить ассерт: при перезаписи изменённого файла старое содержимое попадает в снапшот.

- [ ] **Step 9: Полный прогон + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS все ~30 файлов.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(sync-engine): fail-closed safety snapshots before every live-file mutation (K6,K7)"
```

---

### Task 9: Resolver — manual без контента = ошибка (К5)

**Files:**
- Modify: `src/main/sync/engine/resolver.ts` (executeResolve, до targets/session)
- Test: `tests/main/engine/resolver.test.ts`

- [ ] **Step 1: Падающий тест** (добавить в resolver.test.ts, использовать существующий сетап файла)

```ts
it('rejects manual choice without editedContent before any write', async () => {
  // взять минимальный valid ResolverState из существующих тестов файла,
  // у одного файла choice: 'manual', editedContent: undefined
  const r = await executeResolve({ ...argsFromExistingSetup, resolutions: stateWithManualNoContent })
  expect(r.kind).toBe('error')
  if (r.kind === 'error') expect(r.message).toMatch(/manual/i)
  // живой файл не изменился (сравнить bytes до/после)
})
```

- [ ] **Step 2: Запустить — FAIL** (сейчас файл удаляется)

Run: `npx vitest run tests/main/engine/resolver.test.ts`

- [ ] **Step 3: Реализация** — в `executeResolve` первыми строками тела try:

```ts
    for (const f of resolutions.files) {
      if (f.choice === 'manual' && !f.editedContent) {
        return { kind: 'error', message: `manual resolution for ${f.repoPath} has no content` }
      }
    }
```

- [ ] **Step 4: PASS + commit**

Run: `npx vitest run tests/main/engine/resolver.test.ts`

```bash
git add -A
git commit -m "fix(sync-engine): resolver rejects manual choice without content instead of deleting the file (K5)"
```

---

### Task 10: set-config больше не удаляет папки репы (К6b)

**Files:**
- Modify: `src/main/ipc.ts:238-251` (удалить блок)
- Modify: `tests/main/ipc.test.ts` (тест на cleanup — инвертировать)

- [ ] **Step 1: Найти тест на cleanup**

Run: `npx vitest run tests/main/ipc.test.ts` и grep `rmSync|cursor/projects` по `tests/main/ipc.test.ts`. Если есть тест «удаляет папку удалённого проекта» — переписать его ожидание: папка ДОЛЖНА остаться.

- [ ] **Step 2: Удалить блок** ipc.ts строки 238–251 (комментарий «Clean up working-tree directories...» + `const previous = readConfig(...)` + цикл с `rmSync`). Удалить `rmSync` из импорта `node:fs` в ipc.ts, если больше не используется.

- [ ] **Step 3: Тест-инверсия**

```ts
it('set-config keeps repo dir of removed cursor project (toggle-off ≠ delete)', async () => {
  // зарегистрировать проект, создать <repo>/cursor/projects/<name>/file,
  // сохранить конфиг без проекта → каталог существует
  expect(existsSync(projDirInRepo)).toBe(true)
})
```

- [ ] **Step 4: PASS + commit**

Run: `npx vitest run tests/main/ipc.test.ts && npx tsc --noEmit`

```bash
git add -A
git commit -m "fix(sync-engine): unregistering a project no longer deletes its repo content (K6b)"
```

---

### Task 11: UI + i18n (skipped-секция PullModal, foreign-warning, словари)

**Files:**
- Modify: `src/shared/api.ts` (SyncStatus + foreignPaths)
- Modify: `src/main/sync-status.ts` (прокинуть foreignPaths)
- Modify: `src/renderer/components/PullModal.tsx`
- Modify: `src/renderer/components/SyncStatusIndicator.tsx` (StateSummary)
- Modify: `src/renderer/i18n/locales/en.json`, `ru.json`

- [ ] **Step 1: Типы и адаптер**

`src/shared/api.ts`, `SyncStatus`: добавить `foreignPaths?: string[]`.
`src/main/sync-status.ts`, в `getSyncStatus` после построения `out`:
```ts
  if (s.foreignPaths.length > 0) out.foreignPaths = s.foreignPaths
```

- [ ] **Step 2: Локали**

`en.json` — после `"pull.modal.deletedHint"`:
```json
  "pull.modal.skipped": "{{n}} skipped — unreadable locally",
  "pull.modal.skippedHint": "These files could not be read on this machine (locked or invalid JSON). They were NOT overwritten and will sync once readable.",
```
после `"sync.status.localChanges"` блока (рядом с popover-ключами; найти `"sync.popover.`):
```json
  "sync.popover.foreignPaths": "Unknown paths in repo (not synced)",
```
`ru.json` — те же ключи:
```json
  "pull.modal.skipped": "{{n}} пропущено — не читается локально",
  "pull.modal.skippedHint": "Эти файлы не удалось прочитать на этой машине (lock или битый JSON). Они НЕ перезаписаны и догонят синк, когда станут читаемыми.",
  "sync.popover.foreignPaths": "Незнакомые пути в репе (не синкаются)",
```

- [ ] **Step 3: PullModal — секция skipped**

После `const deleted = ...` добавить `const skipped = items.filter((i) => i.status === 'skipped-unreadable')`.
После секции `deleted` (перед закрывающим `</div>` списка секций) добавить:
```tsx
          {skipped.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500">
                {t('pull.modal.skipped', { n: skipped.length })}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">{t('pull.modal.skippedHint')}</p>
              <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border border-amber-500/40 p-2 font-mono text-xs">
                {skipped.map((i) => (
                  <div key={i.repoPath} className="truncate" title={i.repoPath}>
                    {i.repoPath}
                  </div>
                ))}
              </div>
            </section>
          )}
```

- [ ] **Step 4: StateSummary — foreign warning**

В `SyncStatusIndicator.tsx`, функция `StateSummary` (строка 322), после блока `status.localChanges > 0` добавить перед `return`:
```tsx
  const foreignCount = status.foreignPaths?.length ?? 0
```
и в JSX после `{lines.map(...)}`:
```tsx
      {foreignCount > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-amber-600 dark:text-amber-500">{t('sync.popover.foreignPaths')}</span>
          <span className="tabular-nums font-medium text-amber-600 dark:text-amber-500">{foreignCount}</span>
        </div>
      )}
```

- [ ] **Step 5: Проверка словарей + tsc + рендерер-тесты**

Run: `npx vitest run tests/renderer/ && npx tsc --noEmit`
Expected: PASS (dictionaries.test.ts проверяет паритет ключей en/ru).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sync-engine): surface skipped-unreadable and foreign paths in UI (i18n ru/en)"
```

---

### Task 12: Финальная верификация и push

- [ ] **Step 1: Полный тестовый прогон**

Run: `npx vitest run`
Expected: все тесты PASS (0 failed). Прочитать вывод реально.

- [ ] **Step 2: Типы и линт**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 ошибок.

- [ ] **Step 3: Сборка**

Run: `npm run build`
Expected: успешная сборка electron-vite.

- [ ] **Step 4: Сверка со спеком**

Пройти по списку К1–К7 спека `2026-06-10-engine-data-safety-design.md` §1 и убедиться, что каждый пункт закрыт соответствующей задачей (К1→Task 6, К2→Task 5, К3→Tasks 1-2, К4→Tasks 3-4, К5→Task 9, К6→Task 8 (cursor-install), К6b→Task 10, К7→Tasks 7-8). UI-проверка через computer-use — отложена до релизного этапа (workflow пользователя).

- [ ] **Step 5: Push**

```bash
git push origin sync-engine
```

- [ ] **Step 6: Отчёт пользователю** — список коммитов, вывод vitest/tsc/lint/build, что отложено (restore-UI, манифест, релиз).
