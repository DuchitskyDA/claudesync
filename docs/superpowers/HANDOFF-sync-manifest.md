# HANDOFF — Sync Manifest (под-проект №2), продолжение в новой сессии

**Дата:** 2026-05-29
**Ветка:** `sync-engine` (коммитим сюда, НЕ в worktree).
**Статус:** Tasks 1–7 готовы, зелёные, закоммичены и запушены. Осталось Tasks 8–12.

## Как продолжить (1 команда для разгона)
Открой новый чат и скажи:
> «Продолжай под-проект №2 sync-manifest по плану `docs/superpowers/plans/2026-05-29-sync-manifest.md`, начиная с Task 8, через superpowers subagent-driven-development. Контекст — в `docs/superpowers/HANDOFF-sync-manifest.md`.»

## Документы
- **План:** `docs/superpowers/plans/2026-05-29-sync-manifest.md` (12 задач, полный код для 1–7, контракты+ключевой код для 8–12).
- **Спека:** `docs/superpowers/specs/2026-05-29-sync-manifest-design.md`.
- **North-star:** `docs/superpowers/specs/2026-05-28-sync-architecture-redesign-design.md` (раздел 5 — порядок под-проектов).
- **№1 (предыдущий, готов):** `docs/superpowers/specs/2026-05-29-sync-safeguards-design.md`.

## Что СДЕЛАНО (Tasks 1–7) — не трогать, оно зелёное
6 чистых модулей `src/main/sync/manifest/` + тесты `tests/main/manifest/` (26 тестов):
- `schema.ts` — типы `Manifest`/`ManifestEntry` + `parseManifest`/`serializeManifest` (бросает на битом).
- `membership.ts` — `globalPathCategory(rel)`, `entryId(surface,category,project?)`, `hasActiveEntry(id,active)`.
- `synth.ts` — `synthManifest(cfg)`, `synthActivation(cfg)` (миграция 1:1 из тогглов).
- `resolve.ts` — `resolveActiveEntries(manifest,{activation,knownEntryIds}) → {active,newEntryIds}` (opt-in для новых; capability никогда не active).
- `grow.ts` — `growManifest(repoManifest,activeLocalEntries) → {manifest,addedIds}` (только добавляет).
- `io.ts` — `readManifest(repo)|null` (бросает на битом), `writeManifest(repo,m)` (atomic temp+rename, `.claudesync/manifest.json`).
- Config: `AppConfig.manifestActivation: Record<string,boolean>` + `knownEntryIds: string[]` (`src/shared/api.ts`, `src/main/config.ts`), миграция absent→`{}`/`[]`. `Settings.tsx` setConfig пробрасывает их.

## Что ОСТАЛОСЬ (Tasks 8–12) — из плана
- **8 — `source-enum` на membership:** `enumClaudeSource(claudePath, projects, active: ManifestEntry[])` вместо `syncGlobal`. Floor (`isClaudePathIgnored`) ПЕРВЫМ, потом `globalPathCategory` + `hasActiveEntry(entryId(...), active)`. Сохранить `{entries, unreadable}` из №1. (Полный код enumClaudeSource — в плане, Task 8 Step 3.)
- **9 — engine:** `RefreshArgs` заменить `syncGlobal` на `manifestActivation`+`knownEntryIds`+`claudeConfigForSynth`. `effectiveActiveEntries(args)` = `readManifest(repo) ?? synthManifest(cfg)` → resolve; bootstrap (knownEntryIds пуст → seed all on). HEAD-filter по active-id (та же симметрия, что в №1). `grow`+`writeManifest` на push ДО `buildAndCommitFromSource`; проверить, что `index-builder` стейджит `.claudesync/` (сейчас, вероятно, только `claude/`+`cursor/` — расширить). Обновить ВСЕ места построения `RefreshArgs`/`PushArgs` (grep `syncGlobal:`).
- **10 — install F2/F3:** генератор install-скрипта (`src/main/sync/claude.ts` + `templates/install.{sh,ps1}.template`) разворачивает пути из активных записей манифеста (вкл. `projects/<name>/.claude/` и вложенные `commands/sub/`).
- **11 — UI:** IPC `get-manifest-view` + `set-manifest-activation`; `Settings.tsx` рендерит тогглы из записей манифеста (бейдж «новое» для `newEntryIds`, capability «скоро»). i18n en/ru.
- **12 — интеграция:** `tests/main/manifest/migration.test.ts` + `manifest-roundtrip.test.ts`; финальная валидация.

## КРИТИЧЕСКИЕ правила (нарушались субагентами в №1 — проверять на ревью!)
1. **БЕЗ git-операций у субагентов.** Коммит/пуш — только по явной команде пользователя. (В этой сессии я однажды ошибочно сделал `git stash` — не повторять.)
2. **Проверять ОБА tsconfig:** `npx tsc --noEmit -p tsconfig.json` (renderer/shared) И `npx tsc --noEmit -p tsconfig.node.json` (main-процесс: engine/ipc/manifest/source-enum). Субагенты в №1 проверяли только первый и пропустили реальные ошибки в `claude.ts`/`ipc.ts`.
3. **Двухэтапное ревью каждой интеграционной задачи.** В №1 Task 6 субагент добавил «подметающий» обход, удалявший служебные файлы (`.credentials.json`, `sessions/`) — поймало только ревью. На рефакторе движка (Task 9) ревьюить инвариант: удаление только явное, floor первым, симметрия push/HEAD (нет фантомных удалений).
4. **IPC-граница не типизируется end-to-end:** `get-repo-status`/`preview-push-status` возвращают `RepoStatus` — при смене формы проверять рантайм-консьюмеров (в №1 был латентный креш `[...s.added]`).
5. **Стейджить точечно, НЕ `git add -A`:** иначе влетают артефакты. `.gitignore` уже блокирует `src/**/*.js`, `.claude/worktrees/`, `.claude/scheduled_tasks.lock`. `.claude/settings.local.json` — НЕ коммитить (tracked, но локальный).
6. **Модель субагентов:** haiku — механические задачи по готовому коду; sonnet — интеграция (8,9,10,11). Всегда передавать `model` и запрет git в промпт.

## Команды верификации
```
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.node.json
npx eslint src tests --ext .ts,.tsx --no-error-on-unmatched-pattern
npx vitest run tests/main/manifest      # ядро №2
npx vitest run tests/main/engine        # после Task 8/9
npx vitest run                          # финал; safe-storage (2) и EPERM-флаки — предсуществующие Windows, не наши
```

## Архитектурные решения (зафиксированы в брейншторме)
- Категорийная схема (glob-поле зарезервировано, матчер НЕ реализуется в №2).
- Манифест в репе = offered set («меню»); устройство хранит активацию; новые offered → opt-in (выкл).
- Repo-манифест выигрывает/adopt; synth — только когда манифеста в репе нет.
- Служебные ignore = жёсткий floor под манифестом (манифест не включает секреты).
- Capability — только в схеме, без исполнителя (№4).
- Произвольные папки/якоря, мульти-источник = №3.
