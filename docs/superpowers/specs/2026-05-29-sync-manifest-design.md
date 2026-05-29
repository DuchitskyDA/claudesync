# Sync Manifest (под-проект №2) — design

**Status:** draft, awaiting user review
**Date:** 2026-05-29
**Owner:** brainstormed with the user, written by Claude Code
**North star:** [`2026-05-28-sync-architecture-redesign-design.md`](2026-05-28-sync-architecture-redesign-design.md) — это под-проект №2 из раздела 5.
**Builds on:** №1 safeguards (`2026-05-29-sync-safeguards-design.md`, committed) и flexible-sync-toggles.

> Манифест становится **авторитетом членства**: что синкается, определяется записями манифеста, а не хардкодом `rules.ts` + тогглами. Один источник. Capability — только в схеме (без исполнителя). Произвольные папки/якоря и мульти-источник — №3.

---

## 1. Цель и границы

**Цель:** заменить хардкод-правила членства (`rules.ts` + `syncGlobal`/per-project флаги) единой моделью — **манифест в репе** (offered set) + **локальная активация** на устройстве. Закрыть F2/F3 (install/reverse-mirror идут от манифеста единообразно).

**В границах №2:**
- Категорийная схема манифеста (glob-поле зарезервировано, матчер не реализуется).
- Один источник (одна репа).
- Синтез манифеста при миграции; adopt существующего манифеста из репы.
- Слои: репо = offered, устройство = активация; новые offered-пункты — opt-in.
- Обобщённый toggle-UI из манифеста.
- Capability-записи несутся в схеме, не исполняются.

**Вне границ (позже):** произвольные папки/якоря, мульти-источник, EPIC (№3); исполнитель capability (№4); glob-матчинг; per-key выбор в settings.json.

---

## 2. Решения брейншторма (зафиксированы)

| # | Развилка | Решение |
|---|---|---|
| 1 | Граница №2 | Манифест как авторитет членства, один источник, capability только в схеме. Строгая декомпозиция на мелкие ПОЛНОСТЬЮ независимые модули + максимальное покрытие тестами (быстрая локализация багов). |
| 2 | Модель записи | **Категорийная**, glob-поле зарезервировано (матчер не реализуется в №2). |
| 3 | Жизненный цикл | **Репа выигрывает / adopt.** Есть манифест в репе → устройство адоптит как offered-set, хранит локальную активацию. Синтез — только когда манифеста в репе нет (первое устройство bootstrap'ит). |
| 4 | Новые offered-пункты (появились позже) | **Opt-in:** доступны в UI, но выключены; пользователь включает явно. Согласуется с инвариантом №1 «ничего неявного». |
| 5 | Служебные ignore | **Жёсткий floor под манифестом** — манифест не может включить `sessions/`, `.credentials.json`, `plugins/`, локи и т.п. Применяется первым. |
| 6 | Хранение активации | В существующем `config.json` (`manifestActivation` + `knownEntryIds`). |
| 7 | Расположение манифеста | `.claudesync/manifest.json` в корне репы, поле `version: 1`. |

---

## 3. Модель данных

```ts
// src/main/sync/manifest/schema.ts
export type ManifestSurface = 'claude-global' | 'project'
export type ManifestCategory =
  | 'claudeMd' | 'commands' | 'skills' | 'settings'   // claude-global
  | 'memory' | 'dotclaude'                            // project

export type ManifestFileEntry = {
  kind: 'file'
  /** Stable cross-device key, e.g. 'claude-global:commands', 'project:erp:memory'. */
  id: string
  surface: ManifestSurface
  category: ManifestCategory
  /** Present iff surface === 'project'. Cross-device-stable project name. */
  project?: string
  /** Reserved for future glob support (№3+). NOT matched in №2. */
  path?: string
}

export type ManifestCapabilityEntry = {
  kind: 'capability'
  id: string                       // e.g. 'capability:plugins'
  capability: 'plugins' | 'mcp'
  data: unknown                    // carried, not executed (№4)
}

export type ManifestEntry = ManifestFileEntry | ManifestCapabilityEntry

export type Manifest = {
  version: 1
  entries: ManifestEntry[]
}
```

**`id` — канонический ключ:**
- `claude-global:<category>` для global (`claude-global:commands`).
- `project:<name>:<category>` для проектных (`project:erp:memory`, `project:erp:dotclaude`).
- `capability:<capability>` для capability.

**Категория ⇔ паттерн пути в поверхности** (таблица в `membership.ts`):
| category | surface | path-паттерн (логический) |
|---|---|---|
| claudeMd | claude-global | `CLAUDE.md` |
| commands | claude-global | `commands/**` |
| skills | claude-global | `skills/**` |
| settings | claude-global | `settings.json` |
| memory | project | `memory/**` (под `projects/<encoded>/`) |
| dotclaude | project | `.claude/**` (под `<projectPath>/`) |

**Локальная активация (`config.json`):**
```ts
// добавляется в AppConfig
manifestActivation: Record<string /*entryId*/, boolean>   // явное вкл/выкл
knownEntryIds: string[]                                    // entryId, которые устройство уже «видело»
```
`knownEntryIds` отличает «новый offered-пункт» (нет в known → opt-in, не активен) от «явно выключенного» (в known, activation=false).

---

## 4. Модули (`src/main/sync/manifest/`) — строгая декомпозиция

Каждый модуль = одна ответственность, свой тест-файл. Все чистые, кроме `io.ts`.

| Модуль | Экспорт (контракт) | Чистота |
|---|---|---|
| `schema.ts` | типы выше; `parseManifest(buf): Manifest` (валидация, бросает на битом); `serializeManifest(m): Buffer` (стабильный JSON) | pure |
| `synth.ts` | `synthManifest(cfg: ClaudeConfig): Manifest` — из текущего конфига (категории по `syncGlobal`/проектам; capability — нет в №2) | pure |
| `resolve.ts` | `resolveActiveEntries(manifest, { activation, knownEntryIds }): { active: ManifestEntry[]; newEntryIds: string[] }` — offered ∩ активация, новые (не в known) → не активны | pure |
| `membership.ts` | `pathMembership(relPath, surface, active): string \| null`; `isPathInEntry(relPath, entry): boolean`; таблица категория↔паттерн | pure |
| `grow.ts` | `growManifest(repoManifest, activeLocalEntries): { manifest: Manifest; addedIds: string[] }` — дельта на push (добавить отсутствующие; не удалять) | pure |
| `io.ts` | `readManifest(repoPath): Manifest \| null`; `writeManifest(repoPath, m): Promise<void>` (atomic temp+rename) | I/O |

**Принцип:** баг локализуется в один модуль; функции независимы, тестируются в изоляции без поднятия движка.

---

## 5. Интеграция в движок

### 5.1 Членство (замена хардкода)
- `source-enum`: `enum*` принимают `activeEntries: ManifestEntry[]` вместо `syncGlobal`. Внутри: floor (`isClaudePathIgnored`, остаётся в `rules.ts`) **первым**, затем `pathMembership(rel, surface, activeEntries) !== null`.
- `rules.ts`: служебные ignore-списки и `encodeClaudeProjectSegment` остаются (жёсткий floor + утилиты). Хардкод-гейтинг `isClaudePathSynced(rel, syncGlobal)` удаляется/заменяется на membership.
- `engine.refreshStatus`: вычисляет **эффективный манифест** = `io.readManifest(repo) ?? synth(cfg)` (репо без манифеста → синтез из конфига до первого push) → `resolve` → `activeEntries`; передаёт в enum и в HEAD-фильтр (симметрия push/HEAD из №1 сохраняется — неактивная запись исключается из обеих сторон, фантомных удалений нет).

### 5.2 Рост манифеста на push
- `executePush`: после diff — `grow(repoManifest ?? synth(cfg), activeLocalEntries)`; если есть `addedIds` → манифест записывается (`io.writeManifest`) и попадает в коммит вместе с контентом. Удаление записи из манифеста — отдельное явное действие (UI «перестать предлагать»), не автоматическое.
- Floor/atomic/unreadable (№1) действуют как раньше — манифест над ними.

### 5.3 F2/F3 — install/reverse-mirror от манифеста
- Генератор install-скрипта берёт список разворачиваемых путей из активных записей манифеста (тот же `membership`), а не из хардкода. push-enum, pull-apply и install согласованы по построению.
- F2 (проектные `<name>/.claude/`) и F3 (рекурсивные `commands/sub/`) закрываются: install разворачивает ровно то, что описано записями.

### 5.4 Миграция (config → манифест)
- Загрузка/апгрейд: если `io.readManifest(repo) === null` → `synth(cfg)` хранится в памяти как эффективный манифест, пишется в репу на следующем push (bootstrap). Если манифест есть → adopt; `manifestActivation` строится из текущих тогглов 1:1; все adopt'нутые id попадают в `knownEntryIds`.
- 1:1 маппинг: `syncGlobal.X=false` → `activation['claude-global:X']=false`; `project.syncMemory=false` → `activation['project:<name>:memory']=false`; аналогично `dotclaude`. Иначе — активно.
- Раскладка репы не меняется. Первый sync после миграции: эффективный манифест ≡ синтез из конфига → удалять нечего.

---

## 6. UI

`Settings` (таб Claude) рендерит тогглы **из записей манифеста** (offered), а не из хардкод-списка:
- Каждая `file`-запись → строка с галочкой активации (из `manifestActivation`).
- Новый offered-пункт (id не в `knownEntryIds`) → бейдж «доступно (новое)», галочка выключена; включение записывает в known + activation.
- Capability-записи → строка-категория с пометкой «скоро» (не исполняется).
- Включение записи добавляет/обновляет id в `knownEntryIds`+`manifestActivation` через существующий `setConfig`.

i18n: новые ключи для бейджа «доступно/новое», capability «скоро», заголовков.

---

## 7. Инварианты безопасности (наследуются + расширяются)

1. Жёсткий floor (служебные ignore) — под манифестом, не переопределяется. ← безопасность секретов.
2. Удаление — явное (№1): неактивная/убранная запись не вырезает контент из репы; контент покидает репу только через явное удаление в preview (№1) или явное «перестать предлагать».
3. Симметрия push/HEAD по активным записям → выключение на устройстве не удаляет у других.
4. Битый манифест → ошибка с понятным сообщением (как JSON-guard №1), не молчаливое «пустое членство» (иначе фантомные удаления). При ошибке чтения манифеста — операция блокируется, не деградирует к «ничего не синкать».
5. Floor/unreadable/atomic (№1) действуют под манифестом.

---

## 8. Тестирование (максимальное покрытие, быстрая изоляция)

**Unit (pure, по модулю):**
- `schema.test.ts` — parse валидного; бросает на битом/неизвестной version; round-trip serialize→parse.
- `synth.test.ts` — легаси-конфиги (все комбинации `syncGlobal` + проектные флаги) → ожидаемые entries; пустой конфиг; capability отсутствует.
- `resolve.test.ts` — offered∩активация; новый id (не в known) → не активен; явно выключенный (known+false) → не активен; precedence.
- `membership.test.ts` — параметрически все категории ↔ пути (вкл. рекурсивные `commands/sub/x`, `.claude/...`), floor-пути → null, неактивная категория → null.
- `grow.test.ts` — добавление отсутствующих; не удаляет; идемпотентность (нет дельты, если всё уже в манифесте).
- `io.test.ts` — write→read round-trip; atomic (нет `.tmp-` остатков); read отсутствующего → null; битый файл → бросает.

**Миграция/регрессия:**
- legacy config → synth → ожидаемый манифест; adopt-путь (репо-манифест + 1:1 активация).
- Регрессия: эффективный манифест ≡ synth(текущий конфиг) → `refreshStatus` даёт ноль локальных изменений (нет фантомов после миграции).

**Интеграция:**
- round-trip харнес прогоняется через манифест: synth→write→resolve→enum→push→pull, байтовая идентичность синкаемого, отсутствие служебного.
- F2/F3: install-генератор от манифеста разворачивает проектные `.claude/` и вложенные `commands/sub/`.

**Инварианты №1:** существующие тесты floor/unreadable/atomic остаются зелёными.

---

## 9. Файлы

**Создать:**
- `src/main/sync/manifest/{schema,synth,resolve,membership,grow,io}.ts`
- `tests/main/manifest/{schema,synth,resolve,membership,grow,io}.test.ts`
- `tests/main/manifest/migration.test.ts`, `tests/main/manifest/manifest-roundtrip.test.ts`

**Изменить:**
- `src/shared/api.ts` — `AppConfig`: `manifestActivation`, `knownEntryIds`. (Возможно депрекация `syncGlobal`/per-project флагов — оставить для миграции, читать при synth, не использовать в движке.)
- `src/main/config.ts` — чтение/миграция новых полей.
- `src/main/sync/engine/source-enum.ts` — `enum*` принимают `activeEntries`, зовут `membership`.
- `src/main/sync/engine/rules.ts` — убрать хардкод-гейтинг членства, оставить floor + утилиты.
- `src/main/sync/engine/engine.ts` — загрузка/resolve манифеста; `grow` на push; HEAD-фильтр по активным записям.
- `src/main/sync/claude.ts` / install-генератор + `templates/install.{sh,ps1}.template` — список путей от манифеста (F2/F3).
- `src/main/ipc.ts`, `src/preload/index.ts` — манифест/активация наружу; setActivation.
- `src/renderer/components/Settings.tsx` — рендер тогглов из манифеста.
- `src/renderer/i18n/locales/{en,ru}.json` — новые ключи.
- Тесты движка/конфига/roundtrip — под новые сигнатуры.

---

## 10. Открытые вопросы (мелкие, решаются в плане)
- Точный момент записи манифеста при bootstrap (на первом push vs при первой настройке) — вероятно на push, рядом с grow.
- Депрекация `syncGlobal`/per-project флагов: оставить в схеме конфига как «legacy, только для synth» или удалить после миграции-на-запись. Вероятно оставить read-only для идемпотентной миграции.
- Формат `capability.data` (плагины/MCP) — минимальный для переноса; детализация в №4.
- Нужен ли отдельный модуль `manifest/diff.ts` для UI-показа «что появилось/исчезло в offered» — возможно, решить в плане.
