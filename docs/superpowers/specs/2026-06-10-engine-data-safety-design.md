# Engine Data Safety — design (этапы 1+2 плана стабилизации синка)

**Status:** approved by user (дизайн-секции подтверждены 2026-06-10)
**Date:** 2026-06-10
**Owner:** brainstormed with the user, written by Claude Code
**Prereq reading:** [2026-05-28-sync-architecture-redesign-design.md](2026-05-28-sync-architecture-redesign-design.md) (north star), аудит 2026-06-10 (в чате; ключевые находки продублированы ниже).

---

## 1. Зачем

Аудит 2026-06-10 показал: целевая модель движка (`sync-engine` ветка) верная, но в ней остаются семь дыр потери/перетирания данных (К1–К7) и нет механического последнего рубежа. Этот спек закрывает их разом — это блокер релизного этапа 3 (merge `sync-engine` → `main`).

### Находки аудита, которые закрывает этот спек

| # | Находка | Где |
|---|---|---|
| К1 | `unreadable` не считается в `localChanges` → diverged-guard не срабатывает → pull молча перезаписывает локально изменённый, но нечитаемый файл; для `settings.json` `mergeSettingsForPull` при unparseable локальном файле возвращает `headBlob` целиком → теряются `env`-ключи | `engine.ts:147`, `pull-apply.ts:39-43` |
| К2 | Возврат `walk()` игнорируется; ошибки `lstat`/`stat` — молчаливый `continue`. Файлы под нечитаемым каталогом выпадают из скана → компаратор помечает их `deleted` вместо `unreadable` | `source-enum.ts:40-48,85,116,138` |
| К3 | Нет мьютекса между engine-операциями: push/pull/discard/resolve/install/refresh и legacy `run-sync` выполняются параллельно; оба пишут `refs/heads/main` + `syncWtToHead` — последний побеждает, коммит первого осиротеет; параллельные `git fetch` дают lock-ошибки → ложный `offline` | `ipc.ts:565,670,690`, `engine.ts:296-307,464-468`, `runner.ts:69-77` |
| К4 | Асимметрия push/pull для неизвестных путей под `claude/`: HEAD-фильтр возвращает `true` для путей вне четырёх категорий, pull-preview их не отфильтровывает → pull тянет посторонний файл в `~/.claude`, после чего он вечно висит phantom-`deleted` | `engine.ts:71`, `engine.ts:362-370` |
| К5 | Resolver: `choice: 'manual'` без `editedContent` → `applyToSource(null)` → удаление файла | `resolver.ts:180` |
| К6 | `installCursorProject` перетирает локально изменённые файлы `cpSync` без бэкапа | `cursor-install.ts:21-23` |
| К6b | `set-config` молча `rmSync` поддерево `cursor/projects/<name>/` в репе при удалении проекта из конфига — нарушает «toggle-off ≠ delete» и инвариант WT=HEAD | `ipc.ts:243-250` |
| К7 | Ни одна мутация живых файлов не делает снапшот «как было» — вся защита логическая, механического рубежа нет | весь движок |

## 2. Решения (зафиксированы с пользователем)

| Развилка | Решение |
|---|---|
| Скоуп | Этапы 1 и 2 — один спек, одна ветка работ |
| Pull при нечитаемом локальном файле | Скип файла + warning; остальной pull проходит; HEAD двигается, файл догонит позже обычным diff'ом |
| Удаление проекта из конфига | Репу не трогаем (`rmSync` удаляется). Удаление контента из репы — позже явным действием в манифест-UI (этап 4) |
| Ротация снапшотов | Старше 30 дней удаляем, но всегда держим минимум 10 последних сессий |
| Мьютекс | In-process async-мьютекс (promise-очередь), один на все мутирующие операции включая legacy `run-sync` |
| Симметрия фильтров | Единый модуль `classifyRepoPath`, используемый и HEAD-фильтром, и pull-preview |
| Снапшоты | Явная snapshot-сессия (`beginSnapshot` → `preserve` → `commit`), `applyToSource` остаётся чистым примитивом |

## 3. Новые модули

### 3.1 `src/main/sync/engine/op-lock.ts`

Promise-очередь (FIFO), без таймаутов.

```ts
withExclusiveLock<T>(opName: string, fn: () => Promise<T>): Promise<T>
isLocked(): boolean
```

- Оборачиваются IPC-хендлеры: `run-push`, `execute-pull-apply`, `discard-local-changes`, `resolver-execute`, `run-install`, `init-repo`, legacy `run-sync` (его `withRunLock` в `runner.ts` заменяется этим lock'ом — один на всех).
- `refresh-sync-status` lock НЕ берёт: при `isLocked()` возвращает `{ busy: true }` без выполнения; renderer оставляет прошлый снимок чипа.
- Вторая операция при занятом lock'е встаёт в очередь (UI и так блокирует кнопки во время операции — очередь короткая).

### 3.2 `src/main/sync/engine/path-membership.ts`

Единственный источник истины «принадлежит ли repo-путь синку». На этапе 4 внутренности заменит манифест.

```ts
type Classified =
  | { ok: { source: SourceRef; surfacePath: string } }
  | { skip: 'unknown-path' | 'toggle-off' | 'unregistered-project' }

classifyRepoPath(repoPath: string, ctx: {
  claudeProjects: ClaudeProject[]
  cursorProjects: CursorProject[]
  syncGlobal: ClaudeGlobalSyncFlags
}): Classified
```

Потребители (инлайн-логика удаляется):
- HEAD-фильтр в `refreshStatus` (`engine.ts:64-84`) + `refForRepoPath`/`refKeyForRepoPath`;
- `computePullPreview` (`engine.ts:362-417`).

Изменение поведения: неизвестный путь под `claude/` → `skip: 'unknown-path'` **в обе стороны** — push его не удаляет, pull не тянет в `~/.claude`. Такие пути попадают в новое поле `EngineStatus.foreignPaths: string[]` → warning в UI «в репе есть пути вне правил синка». Они не считаются в `localChanges` и не блокируют push/pull.

### 3.3 `src/main/sync/engine/safety-snapshot.ts`

```ts
beginSnapshot(userDataDir: string, opName: string): SnapshotSession
SnapshotSession.preserve(absPath: string): void  // файла нет → no-op
SnapshotSession.commit(): void
sweepSnapshots(userDataDir: string): void        // ротация, вызов из sweepEngineState
```

- Раскладка: `<userData>/safety-snapshots/<ISO-ts>-<op>/files/<N>` + `manifest.json` (массив `{ original, stored, size, sha1 }`).
- Точки вызова — все мутации живых файлов: `executePullApply`, `executeDiscard`, `executeResolve`, `installCursorProjects`, `plugins.applyChanges`. Preserve вызывается для каждого файла, который будет перезаписан или удалён, ДО первой мутации.
- **Fail-closed:** ошибка записи снапшота → операция возвращает `{ kind: 'error' }`, живые файлы не тронуты.
- Ротация при старте приложения (из `sweepEngineState`): сессии старше 30 дней удаляются, но минимум 10 последних сохраняются всегда. Пустые сессии (ничего не preserve'нулось) не создают папку.
- Restore-UI — вне скоупа (следующие этапы); сейчас достаточно того, что данные физически лежат на диске.

## 4. Правки существующих модулей

1. **`source-enum.ts`:** `walk` возвращает `{ failedDirs: string[] }` (rel-префиксы каталогов с упавшим `readdir`); ошибки `lstat`/`stat` на файле → запись в `unreadable` вместо `continue`. В `refreshStatus` все HEAD-файлы под failed-префиксом добавляются в `unreadableSet` (статус `unreadable`, не `deleted`). (К2)
2. **Pull поверх unreadable (К1):** `computePullPreview` сверяет items с `unreadable`-набором из `refreshStatus`; совпавшие получают статус `skipped-unreadable` — не применяются в `executePullApply`, в PullModal показываются отдельной warning-секцией. `mergeSettingsForPull`: unparseable локальный `settings.json` → файл пропускается с тем же warning'ом (вместо возврата `headBlob`).
3. **`resolver.ts` (К5):** `choice: 'manual'` c `editedContent == null` → ошибка валидации до любых записей.
4. **`cursor-install.ts` (К6):** перед `cpSync` поверх существующего файла с отличающимся контентом — `session.preserve()`. Копирование остаётся аддитивным.
5. **`ipc.ts` set-config (К6b):** блок `rmSync` (`ipc.ts:243-250`) удаляется целиком.
6. **`runner.ts`:** `withRunLock` заменяется на `withExclusiveLock` из op-lock.
7. **`sweep.ts`:** дополнительно вызывает `sweepSnapshots`.
8. **Типы (`shared/sync-types.ts`):** `EngineStatus.foreignPaths: string[]`, `PreviewItem.status` расширяется `'skipped-unreadable'`, refresh-ответ получает вариант `{ busy: true }`.
9. **UI:** PullModal — секция «пропущено (нечитаемо локально)»; SyncStatusIndicator/чип — warning-счётчик включает `foreignPaths`; обработка `busy` в `useAppState` (оставить прошлый снимок). i18n: новые строки ru/en.

## 5. Краевые случаи

- Файл стал нечитаемым между preview и apply: `executePullApply` пересчитывает preview уже под lock'ом — пометка применится по свежему состоянию.
- Lock занят, пользователь жмёт вторую кнопку: операция в FIFO-очереди, выполнится после текущей.
- `foreignPaths` в репе: никогда не удаляются и не применяются автоматически; решение об их судьбе — за манифестом (этап 4).
- Снапшот частично записался и операция упала: сессия остаётся на диске (это плюс — данные целы), ротация подметёт по возрасту.

## 6. Тестирование (TDD, существующий vitest-харнес)

Юниты:
- `op-lock`: конкурентные вызовы сериализуются FIFO; `isLocked` во время операции; исключение в fn освобождает lock.
- `classifyRepoPath`: таблица путей (глобальные категории × тогглы, project memory/dotclaude, cursor, unknown-path, unregistered) — push-фильтр и pull-фильтр дают одинаковый вердикт по построению.
- `safety-snapshot`: preserve+manifest корректны; preserve отсутствующего файла — no-op; ротация 30д/мин-10; fail-closed при ошибке записи.
- `resolver`: `manual` без контента → ошибка, файлы не тронуты.
- `mergeSettingsForPull`: unparseable current → «skip»-сигнал, не headBlob.

Интеграция (tmpdir git, существующие фикстуры):
- failed-dir в source → HEAD-файлы под ним `unreadable`, не `deleted`; push сохраняет их блобы.
- pull при битом локальном `settings.json`: файл не перезаписан, `env` цел, остальные файлы применились, HEAD сдвинут.
- регрессия К4: `claude/unknown.txt` в репе → pull не пишет его в `~/.claude`, refresh не показывает phantom-`deleted`, путь виден в `foreignPaths`.
- cursor-install поверх локально изменённого файла → старый контент в снапшоте.
- `executePullApply`/`executeDiscard`/`executeResolve` создают снапшот-сессию с затронутыми файлами.
- round-trip харнес (`tests/main/engine/sync-roundtrip.test.ts`) остаётся зелёным.

## 7. Вне скоупа

- Restore-UI для снапшотов.
- Вайринг манифеста (Tasks 8–12 HANDOFF) — этап 4.
- Релиз, merge в `main`, удаление legacy `run-sync`-пути — этап 3.
- Авто-pull/watcher («всегда актуально») — этап 5.
