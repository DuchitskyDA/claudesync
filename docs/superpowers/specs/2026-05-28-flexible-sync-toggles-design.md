# Flexible Sync Toggles — design

**Status:** draft, awaiting user review
**Date:** 2026-05-28
**Owner:** brainstormed with the user, written by Claude Code

## Why

Сейчас [`src/main/sync/engine/rules.ts`](../../../src/main/sync/engine/rules.ts) жёстко зашивает что синкается из `~/.claude/` и что — нет. У пользователя нет контроля. Плюс две дыры:

1. **Per-project `<project>/.claude/` вообще не синкается.** В [`enumCursorProjectSource`](../../../src/main/sync/engine/source-enum.ts:92) проектный корень обходится только для Cursor-файлов (`.cursorrules`, `.cursor/rules/`, `.cursor/skills/`). Любой `<project>/.claude/CLAUDE.md` или `<project>/.claude/commands/` остаётся на одной машине.
2. **Нет UI для выбора что синкать.** Allow/ignore списки в `rules.ts` — единственная точка контроля, она не выведена в Settings.

Цель: пользователь видит понятный список категорий с чекбоксами в Settings → Claude, может включать/выключать **глобальные** категории (`CLAUDE.md`, `commands/`, `skills/`, `settings.json`) и **per-project** (`memory/`, `.claude/`). Перенос идёт 1:1 (байтово) кроме служебных файлов (текущий ignore-list).

## Goals

- UI-toggle для каждой синкаемой категории — глобальной и per-project.
- Включить `<project>/.claude/` в синк со своим whitelist'ом для `settings.json` и общим ignore-list для служебных файлов.
- Сохранить `settings.json` whitelist (22 ключа) как безопасный дефолт — не разрешать произвольные ключи.
- Round-trip инвариант: то, что включено toggle'ами, переносится source ↔ target побайтово; служебное и выключенное — отсутствует на target.

## Non-goals

- Per-path glob-фильтры. Возможно в будущем (advanced-режим), сейчас нет.
- Изменение `SETTINGS_KEY_ALLOW_LIST`. Whitelist остаётся как есть.
- Per-key выбор в `settings.json`. Тоже отложено.
- Изменение Cursor-флоу — не трогаем.

## Decisions (из брейншторма)

1. **Гранулярность — категории.** Один toggle = одна целая папка/файл. Без tree-checkbox, без glob.
2. **Per-project — два независимых toggle**: `syncMemory` и `syncDotClaude`. Можно включить любую комбинацию.
3. **`settings.json` whitelist остаётся.** Применяется и к глобальному, и к проектному `<project>/.claude/settings.json`.
4. **Дефолты — всё ON.** Для нового пользователя и при миграции существующего конфига — все toggle'ы `true`.
5. **Структура в репе — буквальный `.claude/`** (не `dot-claude/`). Симметрия 1:1 для пользователя важнее edge-кейсов архиваторов.
6. **Toggle-off semantics — per-device фильтр.** Off = "это устройство не читает и не пишет эту категорию". Контент в репе не трогается. На другом устройстве с toggle-on флоу работает как обычно.

## Config schema

В [`src/shared/api.ts`](../../../src/shared/api.ts):

```ts
type ClaudeConfig = {
  enabled: boolean
  path: string | null
  projects: ClaudeProject[]
  // NEW
  syncGlobal: {
    claudeMd: boolean    // ~/.claude/CLAUDE.md
    commands: boolean    // ~/.claude/commands/
    skills: boolean      // ~/.claude/skills/
    settings: boolean    // ~/.claude/settings.json (whitelist остаётся)
  }
}

type ClaudeProject = {
  name: string
  path: string
  // NEW
  syncMemory: boolean       // ~/.claude/projects/<encoded>/memory/
  syncDotClaude: boolean    // <project>/.claude/
}
```

**Миграция** в [`config.ts`](../../../src/main/config.ts) `load()`:
- Отсутствующий `syncGlobal` → `{claudeMd: true, commands: true, skills: true, settings: true}`.
- Отсутствующий `syncMemory`/`syncDotClaude` на проекте → `true`.
- Migrating-on-write: при следующем `setConfig` дефолты материализуются на диск.

## Repo layout

```
<repo>/
├── claude/
│   ├── CLAUDE.md                     # синк по syncGlobal.claudeMd
│   ├── settings.json                 # синк по syncGlobal.settings (whitelist)
│   ├── commands/                     # syncGlobal.commands
│   ├── skills/                       # syncGlobal.skills
│   └── projects/
│       └── <name>/                   # stable cross-device label
│           ├── memory/               # project.syncMemory (как сейчас)
│           └── .claude/              # NEW — project.syncDotClaude
│               ├── CLAUDE.md
│               ├── settings.json     # whitelist same as global
│               ├── commands/
│               └── skills/
└── cursor/projects/<name>/...        # без изменений
```

Маппинг чистый: `<project>/.claude/X` ↔ `<repo>/claude/projects/<name>/.claude/X`.

## Engine changes

### `rules.ts`

- Расширить `isClaudePathSynced(rel)` → `isClaudePathSynced(rel, syncGlobal)`: gating глобальных категорий по флагам.
- Новая функция `isProjectDotClaudePathSynced(rel)`:
  - Переиспользует ignore-правила глобального (`plugins/`, `sessions/`, `cache/`, `history.jsonl`, `.credentials.json`, `settings.local.json`, `ide/`, `statsig/`, `*.backup.*`, `.DS_Store`, `Thumbs.db`).
  - Добавляет project-local ignore: `worktrees/`, `scheduled_tasks.lock`.
  - Allow-list — те же категории что глобал: `CLAUDE.md`, `settings.json`, `commands/`, `skills/`.
- `SETTINGS_KEY_ALLOW_LIST` переиспользуется без изменений для проектного `settings.json`.

### `SourceRef` ([`src/shared/sync-types.ts`](../../../src/shared/sync-types.ts))

Расширяем для явной классификации (нужно для toggle gating при push/pull):

```ts
type SourceRef =
  | { kind: 'claude-global' }                                      // RENAMED from 'claude'
  | { kind: 'claude-project-memory'; projectName: string }         // NEW
  | { kind: 'claude-project-dotclaude'; projectName: string }      // NEW
  | { kind: 'cursor-project'; projectName: string }                // unchanged
```

Существующий код, который switch-ит по `kind === 'claude'`, мигрирует на `'claude-global'` + два новых kind'а.

### `source-enum.ts`

- `enumClaudeSource(claudePath, projects, syncGlobal)` — добавляется параметр `syncGlobal`. Walker ходит по всему `~/.claude` как сейчас, классификация на каждом entry:
  - Top-level (`CLAUDE.md`, `commands/`, `skills/`, `settings.json`) → gated by соответствующий флаг в `syncGlobal`. Если `syncGlobal.settings=false` — `settings.json` не попадает в entries (включая ветку с `canonicalizeSettings` в [`source-enum.ts:64`](../../../src/main/sync/engine/source-enum.ts:64)).
  - `projects/<encoded>/memory/...` → gated by `project.syncMemory` для соответствующего зарегистрированного проекта (unregistered — skip как сейчас). Emits `kind: 'claude-project-memory'`.
  - Включённые top-level entries emits `kind: 'claude-global'`.
- Новый `enumClaudeProjectDotClaudeSource(projectPath, projectName)`:
  - Walks `<projectPath>/.claude/`, применяет `isProjectDotClaudePathSynced`, для `settings.json` — `canonicalizeSettings`.
  - Emits под `claude/projects/<name>/.claude/...`, `kind: 'claude-project-dotclaude'`.
  - Вызывается из `engine.ts.refreshStatus` для каждого проекта с `syncDotClaude=true`.

### `engine.ts`

`refreshStatus`:
- Для глобального вызова — передать `cfg.claude.syncGlobal`.
- Для каждого проекта: если `syncMemory` — собрать memory entries; если `syncDotClaude` — вызвать новый `enumClaudeProjectDotClaudeSource`.
- HEAD-side фильтруется симметрично: для каждой выключенной категории HEAD-entries исключаются из compare (не показываются как `deleted-on-source`). Аналогично текущей защите для unregistered projects в [`engine.ts:61-64`](../../../src/main/sync/engine/engine.ts:61).

`surfaceAbsPath` ([`engine.ts:142`](../../../src/main/sync/engine/engine.ts:142)) расширяется обработкой двух новых kind'ов:
- `claude-project-memory` → `<claudePath>/projects/<encoded(project.path)>/memory/<tail>` (как сейчас).
- `claude-project-dotclaude` → `<project.path>/.claude/<tail>`.

### `pull-apply.ts`

- `mergeSettingsForPull` сейчас вызывается в [`engine.ts:316`](../../../src/main/sync/engine/engine.ts:316) только для глобального `settings.json`. Расширяем: вызывать также для `<project>/.claude/settings.json` (по match `source.kind === 'claude-project-dotclaude' && surfacePath === 'settings.json'`).

### Toggle-off semantics

| Действие | toggle=on | toggle=off |
|---|---|---|
| `enumSource` | обходит файлы, выдаёт entries | пропускает категорию, entries=∅ |
| HEAD compare | сравнивает source vs HEAD | HEAD-entries категории отфильтрованы → diff=∅ |
| Push | пушит изменения в репу | ничего не пушит (нечего); существующий контент в репе не трогается |
| Pull preview | показывает входящие изменения | категория не появляется в preview |
| Pull apply | пишет файлы в source | ничего не пишет для этой категории |

Контент в репе живёт независимо от device-local toggle'ов. Если на машине A `syncDotClaude=true` и она запушила `claude/projects/foo/.claude/`, а на машине B `syncDotClaude=false` — на машине B файлы в репе видны (`git ls-tree`), но локальный `<foo>/.claude/` не трогается ни push'ем, ни pull'ом.

Симметричный обратный случай: машина B хочет начать синкать — она ставит `syncDotClaude=true`, делает pull, файлы из репы заезжают локально.

## UI

Изменения только в `src/renderer/components/Settings.tsx`, таб **Claude**.

```
┌─ Tab: Claude ───────────────────────────────────────┐
│ Claude path:  [_______________________] [Browse]    │
│                                                      │
│ ─── Global sync ──────────────────────────────────── │
│   ☑ CLAUDE.md                                        │
│   ☑ commands/                                        │
│   ☑ skills/                                          │
│   ☑ settings.json  (filtered)                        │
│                                                      │
│ ─── Projects ─────────────────────────── [Rescan] ── │
│   [name______] [path____________] [×]                │
│      ☑ memory   ☑ .claude/                           │
│   [name______] [path____________] [×]                │
│      ☑ memory   ☑ .claude/                           │
└──────────────────────────────────────────────────────┘
```

- Глобальные toggle'ы — список checkbox'ов между полем path и списком проектов.
- Per-project — два маленьких checkbox'а на отдельной строке под именем/путём проекта.
- `Save` применяет всё через существующий `setConfig`.

**i18n ключи** (новые):
- `settings.claude.global.title` — "Global sync"
- `settings.claude.global.claudeMd` / `commands` / `skills` / `settings`
- `settings.claude.global.settingsHint` — "Filtered: 22 known-safe keys"
- `settings.claude.projects.memoryToggle` — "memory"
- `settings.claude.projects.dotclaudeToggle` — ".claude/"

## Testing

Главный тест — **round-trip инвариант source ↔ target**. Файл: `tests/sync-roundtrip.test.ts` (новый).

### Fixture builder

`tests/fixtures/sync-roundtrip.ts` создаёт во временных директориях три зоны:

**Source `home/.claude/`:**
- `CLAUDE.md`
- `settings.json` — микс whitelist + non-whitelist ключей (`permissions: {...}`, `userID: "...secret"`, `cachedXxx: 42`)
- `commands/foo.md`
- `skills/bar/SKILL.md`
- `projects/<encoded>/memory/x.md`
- `projects/<encoded>/sessions/y.jsonl` — служебное, должно игнорироваться
- `plugins/zz` / `history.jsonl` / `.credentials.json` / `settings.local.json` — служебные

**Source `proj/<name>/.claude/`:**
- `CLAUDE.md`
- `settings.json` — микс whitelist + non-whitelist
- `commands/baz.md`
- `skills/qux/SKILL.md`
- `settings.local.json` / `worktrees/foo` / `scheduled_tasks.lock` / `.credentials.json` — служебные

**Repo `repo/`** — `git init` без коммитов.

### Helper `roundTrip(cfg)`

1. Запускает `enumClaudeSource(home, projects, cfg.syncGlobal)` + `enumClaudeProjectDotClaudeSource` per project с включённым `syncDotClaude`.
2. `buildAndCommitFromSource` → пишет в `repo/`.
3. Создаёт чистый `target/home/.claude/` и пустые `target/proj/<name>/`.
4. `executePullApply` со всеми изменениями принятыми, source-paths = target-paths.
5. Возвращает `{ sourceTree, repoTree, targetTree }` — рекурсивные `Map<relPath, sha256>`.

### Test cases (parametrised)

| # | Конфиг | Ожидание |
|---|---|---|
| 1 | всё ON | source ≡ target для всех синкаемых файлов (sha256 equal); служебные отсутствуют на target |
| 2 | `syncGlobal.commands=false` | глобальные `commands/*` отсутствуют в repo и target; всё остальное синкается |
| 3 | `syncGlobal.settings=false` | глобальный `settings.json` не в repo; CLAUDE.md/commands/skills/memory/.claude — синкаются |
| 4 | `syncGlobal.claudeMd=false` | глобальный `CLAUDE.md` отсутствует в repo и target |
| 5 | `syncGlobal.skills=false` | глобальный `skills/*` отсутствует в repo и target |
| 6 | `project.syncMemory=false` | `memory/` для проекта отсутствует в repo и target; `.claude/` проекта — синкается |
| 7 | `project.syncDotClaude=false` | `.claude/` проекта отсутствует в repo и target; memory — синкается |
| 8 | оба false для проекта | проект не синкается, но регистрация в реестре остаётся |
| 9 | служебные файлы (любая конфигурация) | `settings.local.json`, `.credentials.json`, `worktrees/`, `scheduled_tasks.lock`, `plugins/`, `sessions/`, `history.jsonl`, `*.backup.*` — никогда не в repo, никогда на target |
| 10 | `settings.json` whitelist | non-whitelist ключи на source остаются (source неизменён); в репу попадают только разрешённые 22 ключа; на target тоже только они |
| 11 | байтовая идентичность не-settings файлов | для всех включённых не-settings: `sha256(source) === sha256(target)` |

### Дополнительно

- **Idempotency**: после round-trip повторный `computePushPreview` → `nothing-to-push`.
- **Cross-machine simulation**: два target'а с разными `syncDotClaude` — после pull у off-target `.claude/` не появилось, у on-target появилось 1:1.
- **Toggle-off не трогает существующий контент в репе**: pre-populate repo через round-trip(toggle=on), затем перезапустить с toggle=off, push → `nothing-to-push` (не deletes).

## Migration impact для существующих пользователей

После обновления:
- Существующие глобальные категории остаются ON (как сейчас) → ноль изменений в репе.
- Per-project `syncMemory=true` для всех зарегистрированных → текущее поведение.
- Per-project `syncDotClaude=true` для всех зарегистрированных → **NEW**, при первом push заедет `.claude/` каждого проекта.
- Поведение flow остаётся preview-based: пользователь видит diff в push-modal и может либо принять, либо выключить toggle перед push.

Release notes должны явно сказать: "After update, your project-level `<project>/.claude/` directories will be included in next push. Disable per-project `.claude` toggle in Settings → Claude if you don't want this."

## Open questions / future work

- **Per-key выбор в `settings.json`** — может понадобиться позже (advanced UI с чекбоксами по ключам). Не сейчас.
- **Glob-based include/exclude** — отдельный advanced-режим. Не сейчас.
- **Совместимость репы со старыми версиями приложения**: старая версия с новым контентом репы (`claude/projects/<name>/.claude/`) проигнорирует новые пути — рассинхрон без вреда. Документировать.
