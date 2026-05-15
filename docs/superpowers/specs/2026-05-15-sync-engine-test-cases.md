# Sync Engine — ручной чеклист проверки в dev режиме

**Когда использовать:** после установки sync-engine ветки, перед merge в main.

**Запуск:** `npm run dev`. Перед каждой группой тестов — закрой и переоткрой приложение, чтобы убедиться что startup-флоу чистый.

**Подготовка:**
- Две машины (или две независимые папки `~/.claude` на одной машине через симуляцию). Обозначаются как **A** (например Mac) и **B** (например Windows).
- На обеих машинах настроен sync-репо с одной и той же origin/main.
- На обеих установлен Claude Code с настоящими live-данными в `~/.claude` (commands/, skills/, settings.json, projects/<hash>/memory/).

---

## 0. Smoke (5 минут)

Цель: убедиться, что приложение запускается и базовый flow жив.

| # | Действие | Ожидание |
|---|---|---|
| 0.1 | Открыть приложение | Чип статуса показывает либо in-sync, либо реальный diff. Никаких exception'ов в DevTools |
| 0.2 | Открыть Settings, проверить что repoPath, claudePath, cursor projects настроены | Все поля заполнены |
| 0.3 | Нажать Refresh чипа (если предусмотрено в UI) | Чип обновляется, никаких ошибок |
| 0.4 | Открыть DevTools → Network — никаких висящих git-операций |  |

---

## 1. Compare / chip status — главный регрессионный тест

Цель: фантомных diff'ов после refresh БОЛЬШЕ НЕТ.

### 1.1 Чистое состояние

| # | Действие | Ожидание |
|---|---|---|
| 1.1.1 | Состояние: source = HEAD (только что после init или Pull) | Чип "in sync" |
| 1.1.2 | Несколько раз обновить чип (refresh button × 5) с интервалом 2 сек | `localChanges` остаётся 0. `behind` / `ahead` стабильны |
| 1.1.3 | Открыть и закрыть Settings → focus вернулся на главное окно | Чип не изменился; не появилось "1 local change" из ниоткуда |
| 1.1.4 | Открыть `<repoPath>/claude/` в файловом менеджере — посмотреть на mtime файлов | mtime файлов **не меняется** между refresh'ами (раньше менялся из-за фонового зеркалирования) |

### 1.2 Локальные изменения в ~/.claude

| # | Действие | Ожидание |
|---|---|---|
| 1.2.1 | В `~/.claude/CLAUDE.md` дописать строку и сохранить | Refresh чипа → "1 local change", state = local-changes |
| 1.2.2 | Откатить файл назад к исходному | Refresh → "in sync" |
| 1.2.3 | Удалить файл в `~/.claude/commands/foo.md` | Refresh → "1 local change" (status='deleted' под капотом) |
| 1.2.4 | Восстановить файл (создать заново с тем же содержимым) | Refresh → "in sync" |
| 1.2.5 | Добавить новый файл `~/.claude/commands/new.md` | Refresh → "1 local change" |

### 1.3 Volatile settings.json (THE BUG)

| # | Действие | Ожидание |
|---|---|---|
| 1.3.1 | Зайти в `~/.claude/settings.json` и убедиться что там есть `numStartups`/`cachedChangelog`/`tipsHistory` | (это служебные поля Claude) |
| 1.3.2 | Запустить и закрыть Claude Code (`numStartups` инкрементится) | В sync-app: Refresh чипа → **никаких local-changes** (поле в allow-list-фильтре, игнорируется) |
| 1.3.3 | Открыть Push modal (предполагая, что local-changes есть из 1.2) | settings.json в превью **отсутствует** или показан только если ты руками менял permissions/hooks/etc |
| 1.3.4 | Сделать Push, дождаться завершения | Push не закоммитил `numStartups` (проверить commit на GitHub — там только allow-list поля) |

---

## 2. Push flow

### 2.1 Happy path

| # | Действие | Ожидание |
|---|---|---|
| 2.1.1 | Внести 2-3 изменения в `~/.claude/` (изменить CLAUDE.md, добавить новую команду, удалить старую) | Чип → "3 local changes" |
| 2.1.2 | Клик Push → открывается Push modal с списком изменённых файлов | Список содержит ровно 3 элемента: M CLAUDE.md, A commands/new.md, D commands/old.md |
| 2.1.3 | Вписать commit message → Confirm | Шаги export → pull → commit → push (синтезированные) → success toast |
| 2.1.4 | Refresh чипа | "in sync" |
| 2.1.5 | На GitHub: проверить новый commit | Commit содержит ровно 3 изменения; никаких volatile полей в settings.json |
| 2.1.6 | Открыть `<repoPath>/claude/` в файловом менеджере | Содержит ровно то, что в HEAD (т.е. WT == HEAD) |

### 2.2 Nothing to push

| # | Действие | Ожидание |
|---|---|---|
| 2.2.1 | В состоянии in-sync, открыть Push modal | (если кнопка скрыта — это правильно) |
| 2.2.2 | Если открыть руками через debug — Confirm | Сообщение "nothing-to-push", commit не создаётся |

### 2.3 Race (другая машина обогнала)

| # | Действие | Ожидание |
|---|---|---|
| 2.3.1 | Машина B: сделать Push нового commit'а на origin/main | На A чип покажет "behind" после refresh |
| 2.3.2 | На A: сделать локальное изменение, **не** делая Refresh | Чип покажет "diverged" после первого compare |
| 2.3.3 | На A: попытаться Push (если он не скрыт) | Push возвращает diverged → открывается ConflictModal |

### 2.4 Auth / Network

| # | Действие | Ожидание |
|---|---|---|
| 2.4.1 | Отключить интернет, сделать Push | Ошибка "Network error talking to GitHub" с предложением проверить VPN |
| 2.4.2 | Sign out из GitHub в Settings, сделать Push | Ошибка "GitHub auth rejected. Sign out and sign in again" |
| 2.4.3 | Включить интернет / снова sign in, повторить Push | Push проходит |

---

## 3. Pull flow

### 3.1 Happy path

| # | Действие | Ожидание |
|---|---|---|
| 3.1.1 | Машина A: Push изменения (новый файл `~/.claude/commands/foo.md` с содержимым "bar") | На B: чип → "behind" после refresh |
| 3.1.2 | На B: клик Pull | Открывается PullModal с превью |
| 3.1.3 | PullModal показывает "1 new: claude/commands/foo.md" | ✓ |
| 3.1.4 | Confirm Apply | Файл `~/.claude/commands/foo.md` создаётся локально с содержимым "bar" |
| 3.1.5 | Refresh чипа | "in sync"; behind=0, localChanges=0 |
| 3.1.6 | Открыть `~/.claude/commands/foo.md` | Содержимое = "bar" |

### 3.2 Pull с deletion opt-in

| # | Действие | Ожидание |
|---|---|---|
| 3.2.1 | Машина A: удалить `~/.claude/commands/old.md`, Push | На B: чип → "behind" |
| 3.2.2 | На B: клик Pull → PullModal | Раздел "1 removed on remote" → checkbox для `claude/commands/old.md` (по умолчанию НЕ отмечен) |
| 3.2.3 | НЕ ставить галочку, Apply | Локальный `~/.claude/commands/old.md` остаётся на месте; HEAD продвинулся |
| 3.2.4 | Refresh чипа | "1 local change" (added: old.md есть в source, нет в HEAD) — корректно |
| 3.2.5 | Повторить сценарий, в этот раз поставить галочку | Локальный файл удалён; чип "in sync" |

### 3.3 Pull когда нечего пуллить

| # | Действие | Ожидание |
|---|---|---|
| 3.3.1 | Состояние in-sync, клик Pull (если кнопка не скрыта) | Никаких изменений, никакой ошибки |

### 3.4 Pull offline

| # | Действие | Ожидание |
|---|---|---|
| 3.4.1 | Отключить интернет, клик Pull | Alert "Can't reach GitHub right now. Check VPN/proxy and try again." Чип переходит в offline |
| 3.4.2 | Включить интернет, Refresh чипа | Возвращается к нормальному состоянию |

### 3.5 Pull в diverged состоянии

| # | Действие | Ожидание |
|---|---|---|
| 3.5.1 | Создать diverged: на B сделать локальное изменение в `~/.claude/CLAUDE.md`, потом на A push новый commit в `~/.claude/CLAUDE.md` (другое содержимое) | На B: refresh → state=diverged |
| 3.5.2 | На B кнопки Push и Pull должны быть **скрыты**, видна только кнопка Resolve | ✓ |
| 3.5.3 | Если попытаться открыть PullModal через debug | Возвращает {kind: 'diverged'}, открывается ConflictModal |

---

## 4. Resolver flow (diverged)

### 4.1 Per-file resolve: keep mine

| # | Действие | Ожидание |
|---|---|---|
| 4.1.1 | Создать diverged по сценарию 3.5.1 | ✓ |
| 4.1.2 | Клик Resolve → ConflictModal открывается | Слева список конфликтных файлов; справа три панели base / mine / theirs |
| 4.1.3 | Для CLAUDE.md выбрать "Keep mine" | Файл помечен ✓ |
| 4.1.4 | Когда все файлы помечены, поле commit message доступно | По умолчанию "Merge resolved via claudesync" |
| 4.1.5 | Apply | Прогон → success → modal закрывается |
| 4.1.6 | Refresh | Состояние "in sync" |
| 4.1.7 | Проверить `~/.claude/CLAUDE.md` локально | Содержит локальную версию ("mine") |
| 4.1.8 | На GitHub проверить новый commit | Двухродительский (merge): родители = old HEAD на B + origin/main с A. Содержимое = "mine" |

### 4.2 Per-file resolve: take theirs

| # | Действие | Ожидание |
|---|---|---|
| 4.2.1 | Создать diverged, открыть Resolve | ✓ |
| 4.2.2 | Выбрать "Take theirs" для всех файлов | ✓ |
| 4.2.3 | Apply | success |
| 4.2.4 | `~/.claude/CLAUDE.md` локально | Содержит remote-версию (с A) |

### 4.3 Smешанный resolve

| # | Действие | Ожидание |
|---|---|---|
| 4.3.1 | Создать diverged с несколькими файлами (3+): кто-то "mine", кто-то "theirs" | Resolve modal с per-file выбором |
| 4.3.2 | Apply | Каждый файл получает свою резолюцию; commit имеет двух родителей |

### 4.4 Discard merge state

| # | Действие | Ожидание |
|---|---|---|
| 4.4.1 | Открыть Resolve, выбрать что-нибудь, потом нажать "Discard merge state" | Confirm dialog |
| 4.4.2 | Подтвердить | Modal закрывается, recovery banner исчезает |
| 4.4.3 | Refresh | Состояние всё ещё diverged (мы НЕ резолвили — только сбросили промежуточный state) |

### 4.5 Crash recovery

| # | Действие | Ожидание |
|---|---|---|
| 4.5.1 | Открыть Resolve, выбрать choices для пары файлов | ✓ |
| 4.5.2 | Force-close приложение (Ctrl+Alt+Del / Task Manager kill) | ✓ |
| 4.5.3 | Снова открыть приложение | (опционально: recovery banner показывается; modal автоматически или после клика загружает прежнее состояние) Состояние всё ещё diverged |
| 4.5.4 | Открыть Resolve | Modal показывает новое состояние (был перезапущен computeResolverState) |

---

## 5. Discard flow

| # | Действие | Ожидание |
|---|---|---|
| 5.1 | Сделать 2-3 изменения в `~/.claude/`, не Push'ить | Чип → "N local changes" |
| 5.2 | Кликнуть Discard в чип-popover | Файлы в `~/.claude/` откатываются к HEAD'у (удалённые восстанавливаются, изменённые откатываются, добавленные удаляются) |
| 5.3 | Refresh | "in sync" |
| 5.4 | settings.json после Discard: проверить что `env` и `numStartups` остались НЕ ТРОНУТЫМИ | env / numStartups не должны быть удалены — это локальные ключи, allow-list просто свопает только структурные |
| 5.5 | Особый случай: добавить новый файл `~/.claude/commands/extra.md`, потом Discard | Файл должен быть **удалён** (added → discard = delete from source) |

---

## 6. Init / fresh setup

| # | Действие | Ожидание |
|---|---|---|
| 6.1 | На новой машине C: установить приложение, sign in, Init Repo через wizard | Создаётся новый repo на GitHub с структурой `claude/CLAUDE.md`, `claude/settings.json`, etc. |
| 6.2 | На GitHub проверить файл `claude/settings.json` в первом commit'е | Содержит ТОЛЬКО allow-list ключи (`permissions`, `hooks`, etc.) — НЕТ `env`, `numStartups`, telemetry |
| 6.3 | На C: подключить тот же `~/.claude`, чип | "in sync" с первого refresh'а |

---

## 7. Edge cases

### 7.1 Symlink install mode

| # | Действие | Ожидание |
|---|---|---|
| 7.1.1 | На Windows с Developer Mode: после `install.ps1`, `~/.claude/CLAUDE.md` — симлинк на `<repo>/claude/CLAUDE.md` | `detectClaudeInstallMode` возвращает `'symlink'` |
| 7.1.2 | Изменить файл через `~/.claude/CLAUDE.md` | Refresh: chip показывает diff (так как inode общий с WT, который не = HEAD) |
| 7.1.3 | Push | Корректно коммитит |

### 7.2 Большие файлы (>5MB)

| # | Действие | Ожидание |
|---|---|---|
| 7.2.1 | Положить в `~/.claude/commands/big.md` файл 6MB | SourceEnum его пропускает (не падает, не зависает); чип не показывает его |
| 7.2.2 | Никаких ошибок в DevTools |  |

### 7.3 Невалидный JSON в settings.json

| # | Действие | Ожидание |
|---|---|---|
| 7.3.1 | В `~/.claude/settings.json` сломать JSON (стереть закрывающую скобку) | Refresh: чип не падает; settings.json не учитывается в diff (warning в логах) |
| 7.3.2 | Push в этом состоянии | Push корректно пропускает settings.json или возвращает ошибку — НЕ зависает |
| 7.3.3 | Починить JSON | Возврат к нормальному поведению |

### 7.4 Удалённый файл в `~/.claude` существует только локально

| # | Действие | Ожидание |
|---|---|---|
| 7.4.1 | Машина B: создать локально `~/.claude/commands/B-only.md` | После Pull от A (где этого файла нет) — файл остаётся на B (additive copy) |
| 7.4.2 | На B потом Push | B-only.md появляется в HEAD; теперь A может Pull его |

### 7.5 Pre-existing repo с CRLF

| # | Действие | Ожидание |
|---|---|---|
| 7.5.1 | На Windows с `core.autocrlf=true` глобально, sync-репо склонировано когда-то давно с CRLF в файлах | Чип не покажет ложных diff'ов из-за CRLF↔LF (canonical sha-1 computation работает через `JSON.stringify` → LF) |

### 7.6 Cursor проект зарегистрирован на A но не на B

| # | Действие | Ожидание |
|---|---|---|
| 7.6.1 | A: добавить Cursor проект "MyApp" в Settings, push изменения | B видит чип "behind" |
| 7.6.2 | B: НЕ регистрировать "MyApp", сделать Pull | PullModal показывает либо ничего относящегося к MyApp, либо пропускает строки (не падает) |
| 7.6.3 | B: при diverged между MyApp на A и B (без регистрации) | Resolver пропускает несуществующие проекты, не крашится |

### 7.7 Запуск приложения после crashed push

| # | Действие | Ожидание |
|---|---|---|
| 7.7.1 | Кратко: положить файл `<repoPath>/.git/tmp-index-9999-1` с mtime 2 часа назад | При следующем app startup файл удаляется (sweep) |
| 7.7.2 | Положить аналогичный с свежим mtime (10 минут назад) | Файл сохраняется (не очень старый — возможно активная операция) |

---

## 8. Что НЕ должно происходить (negative tests)

| # | Сценарий | Подтверждение |
|---|---|---|
| 8.1 | Открытие приложения не должно вызывать фоновую модификацию `~/.claude` | Watch the mtime/ctime of `~/.claude/CLAUDE.md` после запуска — не меняется |
| 8.2 | Refresh чипа не должно вызывать модификацию `<repoPath>/claude/` | Watch mtime |
| 8.3 | В diverged state не должно быть возможности случайно нажать Push или Pull | Кнопки скрыты, видна только Resolve |
| 8.4 | Push не должен авто-rebase'ить локальные commits | Если diverged → ошибка, не auto-merge |
| 8.5 | Pull не должен авто-применять изменения без preview | Всегда модальное окно с превью |
| 8.6 | Settings.json после Discard не должен потерять `env` | Локальные API-ключи в env-секции сохраняются |
| 8.7 | git pull/push не должны зависать ждя interactive auth prompt | Если creds invalid → быстрая ошибка, не hang. (NON_INTERACTIVE_ENV проверка) |

---

## 9. Что замерить (если есть желание)

- Размер коммита на GitHub после push'а с настоящими данными: примерно столько же, сколько раньше, или меньше (canonical settings.json без volatile полей).
- Время refresh'а чипа: должно быть быстрее, чем раньше (нет фонового зеркалирования).
- `<repoPath>/.git/objects` после нескольких push'ей — нет orphan'ов через `git fsck` (опционально).

---

## Если что-то не работает

1. **DevTools console** в renderer'е — есть ли исключения?
2. **`<userData>/last-run.log`** — что писали engine операции?
3. **`<userData>/sync-engine-resolve.json`** — если есть и diverged не активен, удалить вручную.
4. **`<repoPath>/.git/`** — есть ли `tmp-index-*` орфаны? (Должны очиститься sweep'ом)
5. **Запустить unit-тесты:** `npm test` — 61 engine-тест должны пройти.

---

## Ожидаемый итог

Все пункты выше зелёные → sync-engine ветка готова к merge.

Если что-то красное → создать issue с указанием конкретного пункта чеклиста, лог из DevTools, что произошло.
