# Sync Safeguards (под-проект №1) — design

**Status:** draft, awaiting user review
**Date:** 2026-05-29
**Owner:** brainstormed with the user, written by Claude Code
**North star:** [`2026-05-28-sync-architecture-redesign-design.md`](2026-05-28-sync-architecture-redesign-design.md) — это под-проект №1 из раздела 5.

> Предохранители на **текущей** модели синка. Без манифеста. Лечит потерю данных немедленно. Подмножество целевой модели (раздел 4.1 north-star), не выкидной код.

---

## 1. Проблема (доказательная база — актуальный код после flexible-toggles)

Движок выводит «удаление» из «отсутствия». Файл, выпавший из энумерации по любой причине, помечается `deleted` и вырезается из репы на push.

| # | Находка | Точка в коде | Статус |
|---|---|---|---|
| F1 | read-error = удаление | `source-enum.ts:63` (stat), `:66` (read), `:68` (битый JSON canonicalize), `:64` (size>5MB) → `return`; `walk:32` (readdir → вся папка молча пропадает) → `comparator.ts:64` `'deleted'` → `index-builder.ts:24` `updateIndexRemove` | ❌ |
| F1b | пустой/недоступный источник = wipe | `source-enum.ts:56,100,126` `if(!existsSync) return []`; floor отсутствует | ❌ |
| F1-surf | preview без `status` | `ipc.ts:450-453` `.map(d=>d.repoPath)` теряет `status`; `PushModal.tsx` показывает плоский список; `run-push` пушит всё без deletion-opt-in | ❌ |
| JSON-guard | мёртвый | `push.error.invalidJson` только в локалях; битый JSON → выпадение → удаление | ❌ |
| atomic | неатомарная запись | `pull-apply.ts:14` прямой `writeFileSync` | ❌ |
| F4 | Discard стирает 'added' | `engine.ts:427-429` молчаливый `applyToSource(null)` за общим confirm | ❌ |

**Принцип-фундамент (north-star):** удаление — всегда явное намеренное событие; его нельзя выводить из отсутствия, ошибки чтения или фильтра.

---

## 2. Решения брейншторма (зафиксированы)

| # | Развилка | Решение |
|---|---|---|
| 1 | Объём №1 | Все 6 пунктов в один спек/план (F1, F1b, F1-surfacing, JSON-guard, atomic, F4). |
| 2 | Политика floor | **Двухуровнево.** Единичные удаления → явный чекбокс-подтверждение в preview. Аномалия → жёсткий отказ push. |
| 3 | Порог floor | Аномалия per-source = (источник пуст при headCount≥1) **ИЛИ** (deleting/headCount ≥ `ratio` **И** deleting ≥ `minAbs`). Дефолт `ratio=0.5, minAbs=5`. Выносится в конфиг. |
| 4 | Read-error | **Continue + warning** для ВСЕХ ошибок чтения (включая битый JSON). Непрочитанный tracked → версия из HEAD сохраняется, push идёт для остального, warning в preview/чипе. |
| 5 | F4 Discard | По умолчанию **не трогать** 'added'; откат только modified/deleted к HEAD. Отдельный чекбокс «также удалить N локально-новых файлов» (дефолт off). |
| 6 | Подход | **A** — расширить контракты `enum→comparator` + чистый модуль `safety-floor`. Comparator остаётся чистой функцией. |

---

## 3. Архитектура

### 3.1 `source-enum.ts` — различать «нет файла» vs «не прочитался»

Каждый enumerator меняет сигнатуру возврата:

```ts
export type EnumResult = {
  entries: FileEntry[]
  /** repoPath'ы файлов, которые СУЩЕСТВУЮТ на диске, но не вычитаны:
   *  stat/read/canonicalize упал или size>MAX_BYTES. НЕ молчаливое выпадение. */
  unreadable: string[]
}
```

- `enumClaudeSource`, `enumClaudeProjectDotClaudeSource`, `enumCursorProjectSource` → `Promise<EnumResult>`.
- При ошибке `statSync`/`readFileSync`/`canonicalizeSettings` или `size>MAX_BYTES`: вычислить repoPath (по тем же правилам трансляции, что для entries) и добавить в `unreadable` вместо `return`/skip.
  - Для memory-путей unreadable вычисляется только для зарегистрированных проектов с `syncMemory=true` (как и entries) — иначе путь вне tracked-набора, его не существует для синка.
- `walk`: при readdir-ошибке директории — пробросить сигнал недоступности. Простейшая реализация: `walk` возвращает `boolean ok`; вызывающий enum, получив `ok=false` на корне источника, считает источник недоступным (см. floor — это эквивалент «источник пуст при непустом HEAD», но без ложного «всё прочитано и пусто»). Недоступность вложенной папки → все её tracked-в-HEAD пути не должны эмитить deletion; реализуется тем, что floor видит аномалию ИЛИ (проще и достаточно для №1) — недоступность корня источника трактуется как floor-аномалия.

**Граница:** `unreadable` в терминах `repoPath` (как `entries[].repoPath`), чтобы comparator сопоставлял с HEAD напрямую.

### 3.2 `sync-types.ts` + `comparator.ts` — статус `'unreadable'`

`DiffEntry.status` расширяется: `'same' | 'modified' | 'added' | 'deleted' | 'unreadable'`.

`compare(source, src, head, claudeProjects, unreadable?)`:
- новый необязательный параметр `unreadable: Set<string>` (repoPath'ы).
- Для `repoPath ∈ unreadable`:
  - есть в HEAD → `{ status: 'unreadable', headSha }` (push сохранит HEAD-версию).
  - нет в HEAD → `{ status: 'unreadable' }` (новый файл не прочитан — нечего пушить/удалять, только warning).
  - **никогда** не `'deleted'`.
- Остальная логика без изменений. Функция остаётся чистой.
- `localChanges` в `refreshStatus` считает `status !== 'same' && status !== 'unreadable'` (unreadable не «изменение к push», а warning).

### 3.3 `safety-floor.ts` (новый) — двухуровневый предохранитель

```ts
export type FloorThresholds = { ratio: number; minAbs: number } // дефолт {0.5, 5}

export type FloorSourceVerdict = {
  source: SourceRef
  headCount: number
  deleting: number
  reason: 'source-empty' | 'ratio-exceeded'
}

export type FloorResult =
  | { ok: true }
  | { ok: false; blocked: FloorSourceVerdict[] }

/** Чистая функция. На вход — diffs (всех источников) и headCount по источнику. */
export function checkFloor(
  diffs: DiffEntry[],
  headCountBySource: Map<string, number>, // ключ — refKey(source)
  thresholds: FloorThresholds,
): FloorResult
```

Per-source: `deleting` = число `status==='deleted'`. Аномалия если:
- `headCount ≥ 1` и `deleting === headCount` и (источник дал 0 живых entries) → `'source-empty'`; **или**
- `deleting >= minAbs` и `deleting / headCount >= ratio` → `'ratio-exceeded'`.

`refKey` — та же сериализация источника, что в `engine.ts` (`'claude-global'` | `'<kind>::<projectName>'`).

**Важно:** unreadable НЕ считаются как deleting (они сохраняются). Это автоматически защищает от F1b: недоступный источник → файлы либо unreadable (если корень читается, но файлы нет), либо floor `source-empty` (если корень недоступен).

### 3.4 `pull-apply.ts` — атомарная запись

```ts
export async function applyToSource(absPath: string, content: Buffer | null): Promise<void> {
  if (content === null) { /* unlink если есть — без изменений */ return }
  mkdirSync(dirname(absPath), { recursive: true })
  const tmp = `${absPath}.tmp-${process.pid}-${counter++}`
  writeFileSync(tmp, content)
  renameSync(tmp, absPath) // атомарно поверх цели на той же ФС
  // на ошибке rename — попытаться unlink(tmp), пробросить
}
```

`renameSync` в пределах одной директории атомарен на NTFS и POSIX. Очистка `.tmp-*` при сбое в `catch`.

### 3.5 `engine.ts` — push / preview / discard

**`refreshStatus`:** прокинуть `unreadable` из enum-результатов в `compare`. Diffs теперь могут содержать `'unreadable'`.

**`computePushPreview` / `executePush`:**
- собрать `headCountBySource` (из `enumHead` per источник).
- вызвать `checkFloor(diffs, headCounts, thresholds)`. Если `!ok` → новый результат:
  ```ts
  | { kind: 'floor-blocked'; verdicts: FloorSourceVerdict[] }
  ```
  push не выполняется.
- `unreadable` исключаются из `items` для commit (build их не трогает → HEAD-версия остаётся в дереве). Передаются в preview отдельной секцией.
- `'deleted'` применяются **только если** `repoPath ∈ approvedDeletions`. Не одобренные удаления → файл остаётся в HEAD-дереве (build пропускает `updateIndexRemove`).

**`PushArgs`** получает `approvedDeletions: string[]`. `buildAndCommitFromSource` уже умеет: для `'deleted'` не в approved — просто не добавляем в diffs, передаваемые в build (фильтрация в engine перед build).

**`executeDiscard`** получает `deleteAdded: boolean` (дефолт false):
- `'added'` стираются только при `deleteAdded === true`.
- `'modified'`/`'deleted'` — откат к HEAD (без изменений).
- `'unreadable'` — пропуск (не трогаем).

`thresholds` приходят из конфига через `RefreshArgs`/`PushArgs`.

### 3.6 IPC + UI

**`@shared/api`** — расширить `RepoStatus`:
```ts
export type RepoStatus = {
  clean: boolean
  added: string[]
  modified: string[]
  deletions: string[]      // repoPath'ы кандидатов на удаление
  unreadable: string[]     // repoPath'ы непрочитанных tracked
  floor:
    | { ok: true }
    | { ok: false; verdicts: { source: string; headCount: number; deleting: number; reason: string }[] }
}
```

**`ipc.ts` `preview-push-status`** — строить эту структуру из `computePushPreview` (а не схлопывать `refreshStatus().diffs`). Прокинуть `thresholds` из конфига.

**`PushModal.tsx`** — секции:
- «Добавлено» (added) — список.
- «Изменено» (modified) — список.
- «Удаляется» (deletions) — список **с чекбоксами** (по умолчанию **сняты**); только отмеченные уйдут в `approvedDeletions`.
- «⚠ Не прочитано, оставлены без изменений» (unreadable) — список, информативный, amber-блок.
- floor-block: если `floor.ok===false` — красный блок с per-source деталями, кнопка Push **disabled**.
- `run-push` (ipc + preload + App) передаёт отмеченные удаления в `executePush`.

**Discard confirm** (`App.tsx` / отдельный мелкий confirm): чекбокс «также удалить N локально-новых файлов» (off). `discard-local-changes` принимает `deleteAdded`.

**i18n** (en/ru) — новые ключи: секции preview, floor-block сообщение, unreadable-warning, discard-added-чекбокс. Переосмыслить `push.error.invalidJson` → `push.warning.unreadable` (или оставить + добавить новые).

---

## 4. Инварианты (раздел 4.1 north-star) → как реализуются

1. Членство явное — уже (rules/toggles из flexible-toggles), без изменений.
2. Удаление — явное событие → `'deleted'` применяется только из `approvedDeletions` (чекбокс). ← F1-surf
3. Ошибка чтения ≠ удаление → статус `'unreadable'`, HEAD-версия сохраняется, warning. ← F1, JSON-guard
4. Floor на массовые изменения → `safety-floor` + `floor-blocked`. ← F1b
5. Атомарная, аддитивная запись → temp+rename в `applyToSource`. ← atomic
6. Симметрия push/pull → floor/unreadable на push; pull уже opt-in + diverged-guard.

**Итог:** данные покидают репу только если (а) явно отмечены к удалению в preview, и (б) не сработал floor.

---

## 5. Обработка ошибок и edge-cases

- **Залоченный файл (Windows lock/EPERM)** — частый кейс: `readFileSync` бросает → `unreadable` → HEAD-версия сохраняется, push остального идёт. Никакого блока на единичном locked-файле.
- **Битый settings.json** — `canonicalizeSettings` бросает → `unreadable` → HEAD-версия settings.json сохраняется, warning. Push не падает.
- **Файл >5MB** — `unreadable` (как и раньше выпадал, но теперь не как deletion). Warning информирует.
- **Весь источник недоступен** (path удалён/отмонтирован) → `existsSync` false или readdir-fail → floor `source-empty` → блок (если headCount≥1).
- **Легитимное удаление 1 файла** (headCount=2) → не аномалия (< minAbs) → чекбокс в preview, пользователь подтверждает.
- **Массовое легитимное удаление** (например, пользователь реально вычистил commands/) → floor блокирует; в №1 обход — снять файлы из синка (в №2 это манифест). Это осознанный trade-off безопасности (решение брейншторма 2/3).
- **Гонка floor vs unreadable**: unreadable никогда не входит в `deleting`, поэтому массовый lock не триггерит floor как удаление.

---

## 6. Тестирование (TDD — тест до кода)

Юнит (чистые, без I/O где возможно):
- `safety-floor.test.ts` — пороги ratio/minAbs; `source-empty`; per-source изоляция (один источник аномален, другой нет); unreadable не считается как deleting.
- `comparator.test.ts` — `'unreadable'` с HEAD (headSha есть) и без HEAD; unreadable никогда не `'deleted'`.

С временной ФС:
- `source-enum.test.ts` — битый JSON settings → `unreadable`, не отсутствует; залоченный/нечитаемый файл → `unreadable` (симуляция через mode/нечитаемость, либо мок fs); файл >MAX → `unreadable`; readdir-fail корня → сигнал недоступности.
- `pull-apply.test.ts` — atomic: после `applyToSource` нет `.tmp-*` остатков; содержимое целиком; (по возможности) симуляция сбоя rename не оставляет повреждённую цель.
- `engine-push.test.ts` — floor-blocked возвращается и push не коммитит; unreadable сохраняет HEAD-версию (commit-tree не меняет blob); deletion применяется только при approve, иначе остаётся.
- `engine-discard.test.ts` — 'added' сохраняются по умолчанию; стираются при `deleteAdded=true`; unreadable не трогается.

Интеграция:
- round-trip харнес (`tests/fixtures/sync-roundtrip.ts`) — без регрессий после смены сигнатур enum.
- (опц.) renderer-тест на секции PushModal, если есть инфраструктура.

Все существующие тесты, дёргающие изменённые сигнатуры (`enum*` возврат, `compare` параметр, `executePush`/`executeDiscard` аргументы, `RepoStatus`), обновляются.

---

## 7. Не-цели / отложено

- Манифест как авторитет членства — под-проект №2.
- Мульти-источник, якоря папок — №3.
- Capability (плагины/MCP) — №4.
- F5 (pull allow-list replace) — by-design, защищён diverged-guard.
- F6 (includeSecrets) — есть предупреждение в UI.
- Per-key выбор в settings.json, glob-фильтры — позже.

---

## 8. Файлы

**Создать:**
- `src/main/sync/engine/safety-floor.ts`
- `tests/main/engine/safety-floor.test.ts`

**Изменить:**
- `src/shared/sync-types.ts` — `status: 'unreadable'`.
- `src/shared/api.ts` — `RepoStatus` расширить; `floorThresholds` в конфиге (опц.).
- `src/main/config.ts` — чтение/дефолт `floorThresholds` (если выносим в конфиг).
- `src/main/sync/engine/source-enum.ts` — `EnumResult` + unreadable + walk-сигнал.
- `src/main/sync/engine/comparator.ts` — параметр `unreadable`, статус.
- `src/main/sync/engine/pull-apply.ts` — atomic write.
- `src/main/sync/engine/engine.ts` — прокинуть unreadable; floor; approvedDeletions; deleteAdded.
- `src/main/ipc.ts` — `preview-push-status` структура; `run-push`/`discard` аргументы.
- `src/preload/index.ts` — сигнатуры IPC.
- `src/renderer/components/PushModal.tsx` — секции + чекбоксы + floor-block.
- `src/renderer/App.tsx` (+ discard confirm) — deleteAdded; approvedDeletions.
- `src/renderer/i18n/locales/{en,ru}.json` — ключи.
- Тесты: `comparator`, `source-enum`, `pull-apply`, `engine-push`, `engine-discard`, round-trip — обновить под новые сигнатуры.

---

## 9. Открытые вопросы (мелкие, решаемые в плане)

- Точное место `floorThresholds` — конфиг-файл vs константа с TODO-вынести. Дефолт `{0.5, 5}` в любом случае.
- Симуляция «нечитаемого файла» в тестах на Windows (mode 0o000 ненадёжен) — вероятно через мок `fs.readFileSync`/инъекцию. Уточнить в плане.
- Нужен ли отдельный `DiscardModal` компонент или достаточно расширить существующий confirm. Уточнить при чтении текущего discard-UI.
