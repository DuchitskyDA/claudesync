# Claude Config Tool — Design Spec

**Дата:** 2026-05-06
**Статус:** Approved (pending user review of this document)
**Автор:** Данила Дуцицкий + Claude

## Цель

Десктопное приложение для синхронизации конфигов Claude Code между несколькими машинами (Mac/Windows/Linux). Запускает `git pull` в указанном «ai-репозитории» (где лежат `global/`, `projects/`, `install.sh`, `install.ps1`) и затем — соответствующий ОС install-скрипт. Показывает прогресс и ошибки в окне.

В будущем — расширяется до утилиты для онбординга коллег (создание подобного репо по шаблону) и автономного сборщика ai-конфига.

## Не-цели (на MVP)

- Auto-update приложения
- Code-signing билдов (Mac notarization, Windows Authenticode)
- Управление содержимым ai-репо (редактирование memory, плагинов и т.д.)
- Онбординг-визард для нового коллеги (это v2+)
- Анализ git-статуса, конфликтов merge — приложение просто показывает stderr `git pull`
- Тёмная/светлая тема как опция — следуем системной
- Локализация — единый язык (русский в UI)

## Контекст

Связанный приватный репозиторий `DuchitskyDA/ai` уже содержит:
- `global/CLAUDE.md`, `global/settings.json`, `global/commands/`, `global/skills/`
- `global/projects/<encoded-path>/memory/` для каждой машины
- `install.sh` (macOS/Linux) и `install.ps1` (Windows) — линкуют файлы из репо в `~/.claude/`

Текущий ручной флоу: `cd ~/path/to/ai && git pull && ./install.sh` (или `install.ps1`). Это приложение автоматизирует флоу одной кнопкой.

Приложение **не** хранит ai-репо внутри себя — пользователь указывает путь к уже клонированному локально репо.

## Стек

- **Electron** (последняя стабильная) — runtime
- **electron-vite** — скаффолд + dev-server с HMR
- **React 18 + TypeScript** — renderer
- **Tailwind CSS** — стили
- **Vitest** — unit-тесты для main-логики
- **electron-builder** — упаковка `.dmg` / `.exe Setup` / `.AppImage`
- **GitHub Actions** — CI билд на 3 ОС, релизы

Никаких state-менеджеров типа Redux на MVP — `useState` + `useReducer` в одном `App.tsx` достаточно.

## Архитектура

Стандартная Electron-структура с тремя процессами:

```
src/
├── main/           # Node.js: запуск дочерних процессов, конфиг, IPC
│   ├── index.ts    # bootstrap, создание окна, регистрация IPC
│   ├── ipc.ts      # IPC handlers (run-update, get-config, set-config, pick-repo-path)
│   ├── runner.ts   # spawn + stream stdout/stderr → IPC events
│   └── config.ts   # read/write userData/config.json + валидация repoPath
├── preload/
│   └── index.ts    # contextBridge: expose AppApi в window.api
├── renderer/       # React UI
│   ├── App.tsx
│   ├── components/
│   │   ├── UpdateButton.tsx
│   │   ├── LogConsole.tsx
│   │   └── Settings.tsx
│   ├── hooks/
│   │   └── useAppState.ts  # state + IPC subscriptions
│   ├── styles.css          # Tailwind entry
│   └── main.tsx
└── shared/
    └── api.ts      # типы AppApi, LogLine, etc — импортируются и main, и renderer
```

Корневые конфиги: `electron.vite.config.ts`, `electron-builder.yml`, `tailwind.config.js`, `tsconfig.json`, `package.json`, `vitest.config.ts`.

### IPC API контракт

```ts
// src/shared/api.ts
export type LogLevel = 'info' | 'error' | 'success'
export type LogLine = { time: string; text: string; level: LogLevel }
export type Platform = 'macos' | 'windows'
export type RunResult = { ok: boolean; exitCode: number; error?: string }
export type AppConfig = { repoPath: string | null }

export interface AppApi {
  runUpdate(platform: Platform): Promise<RunResult>
  getConfig(): Promise<AppConfig>
  setConfig(c: AppConfig): Promise<{ ok: boolean; error?: string }>
  pickRepoPath(): Promise<string | null>
  onLog(callback: (line: LogLine) => void): () => void
  getPlatform(): Promise<NodeJS.Platform>
}
```

`onLog` использует `ipcRenderer.on('log', handler)` и возвращает функцию отписки.

### `runner.ts` — универсальный шелл-раннер

Функция: `runCommand(cmd: string, args: string[], opts: { cwd: string; onLine: (line: LogLine) => void }): Promise<{exitCode: number}>`.

- `child_process.spawn(cmd, args, { cwd, shell: false })`
- stdout → `onLine({level: 'info', ...})`
- stderr → `onLine({level: 'error', ...})`
- Stream построчный (через readline или ручной буфер по `\n`)
- На `proc.on('error')` (например ENOENT) → отдельная log-line + reject
- На `proc.on('exit', code)` → resolve с exitCode

Используется и для `git pull`, и для `install.sh`/`install.ps1`. Расширяемость для будущих фич — те же функция + новый IPC-handler.

### `runUpdate` flow в main

```
1. validate: platform параметр совпадает с process.platform (даркwin/win32). Иначе reject {ok: false, error: 'Platform mismatch'}.
2. validate: config.repoPath задан и существует. Иначе reject {ok: false, error: 'Repo path not configured'}.
3. validate: install скрипт существует (install.sh для mac, install.ps1 для win).
4. emit log: '[time] git pull' (level info)
5. await runCommand('git', ['pull'], { cwd: repoPath, onLine })
6. if exitCode !== 0 → emit log '✗ FAILED (git pull exit N)' красным, return {ok: false, exitCode}
7. emit log '[time] running install...'
8. await runCommand:
   - macOS: ('bash', ['install.sh'])
   - Windows: ('powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'install.ps1'])
9. if exitCode !== 0 → emit log '✗ FAILED' красным, return {ok: false, exitCode}
10. emit log '✓ DONE (exit 0)' зелёным, return {ok: true, exitCode: 0}
```

Лочка от параллельного запуска: `let isRunning = false` в модуле; если уже true — reject `{ok: false, error: 'Already running'}`. Renderer тоже держит локальное `isRunning` и блокирует кнопки.

### `config.ts`

- Файл: `path.join(app.getPath('userData'), 'config.json')`
- Read: если нет файла или JSON невалиден → возвращает `{repoPath: null}`, не падает
- Write: атомарно (temp-файл + rename), валидирует пред этим:
  - `repoPath` существует и это директория
  - `path.join(repoPath, '.git')` существует (любой тип — папка или файл для submodules; нам важно что это git-tree)
  - есть хотя бы один из: `install.sh`, `install.ps1`
- При невалидности возвращает `{ok: false, error: 'human-readable reason'}` — renderer показывает inline в Settings

## UI

Одно главное окно ~700×500, без меню (стандартное Electron-меню только в dev). Светлая/тёмная тема через `prefers-color-scheme` + Tailwind `dark:` классы.

Layout (вертикально):
- **Header bar** — название приложения слева, "⚙ Settings" справа
- **Actions row** — две кнопки рядом: "Обновить (macOS)" и "Обновить (Windows)"; неактуальная для текущей ОС — disabled с tooltip "Available only on macOS" / "...Windows"
- **Repo path chip** — read-only отображение текущего `repoPath` (с иконкой папки), клик открывает Settings
- **Log console** — monospace, фон чуть темнее окна, авто-скролл к низу, цветные строки (error красный, success зелёный, info — обычный foreground), кнопка "Clear log" в углу

**Settings модал** (открывается из шестерёнки или авто при первом запуске без repoPath):
- Поле `Repo path` + кнопка `Browse…` (открывает native folder picker)
- Inline-error если путь невалиден
- Кнопки `Cancel` / `Save`

State в `App.tsx` через `useReducer`:
```ts
{
  repoPath: string | null,
  platform: 'darwin' | 'win32' | 'linux',
  isRunning: boolean,
  log: LogLine[],
  settingsOpen: boolean,
}
```

## Обработка ошибок

| Сценарий | Поведение |
|---|---|
| `git` не в PATH (ENOENT при spawn) | log: красная строка `git not found in PATH. Install git and retry.`, ✗ FAILED |
| `repoPath` не задан / не существует | Кнопки Update disabled, tooltip "Set repo path first", auto-open Settings |
| Папка не git-репо (нет `.git`) | Inline-error в Settings: "Folder is not a git repository" |
| Install скрипт не найден в repoPath | log: `install.sh not found at <path>`, ✗ FAILED |
| `git pull` упал (conflict / no internet / auth) | stderr идёт в лог красным, install НЕ запускается, ✗ FAILED |
| Install скрипт упал | stderr в лог красным, ✗ FAILED |
| Кнопка не той ОС | Disabled заранее |
| Двойной клик / параллельный запуск | Кнопки disabled во время `isRunning`, main также лочит |
| Process crashed (`proc.on('error')`) | log: `Process terminated unexpectedly: <message>`, ✗ FAILED |
| stdout не UTF-8 на Windows | `proc.stdout.setEncoding('utf8')`, мусорная строка идёт в лог как есть, не валим |

**Принцип:** ни одна ошибка не крашит приложение. Финал всегда `✓ DONE` или `✗ FAILED`. Кнопки enable снова, можно повторить.

**Логирование на диск:** последние 200 строк лога дублируются в `userData/last-run.log` для отправки коллегой при проблемах.

## Тесты

| Слой | Подход |
|---|---|
| `runner.ts` | Vitest + мок `child_process.spawn` (через `vi.mock`). Покрытие: успешный exit, ненулевой exit, ENOENT, stderr stream, parallel call locking |
| `config.ts` | Vitest + tmp-папка через `os.tmpdir()`. Покрытие: read нет-файла, read невалидного JSON, write+read round-trip, валидация repoPath |
| `ipc.ts` handlers | Vitest + мок electron API + fake runner. Покрытие: platform mismatch, missing repoPath, передача log events через IPC |
| Renderer-компоненты | Не покрываем юнит-тестами на MVP (тривиальный UI без логики) |
| End-to-end | Ручное на Mac + Windows. Сценарии: success path, fail на git pull (отключить интернет), fail на install (убрать install.sh), settings flow |

CI запускает `vitest` на `ubuntu-latest` (юнит-тесты не зависят от ОС). E2E — ручное на каждой ОС перед релизом.

## Дистрибуция

| ОС | Формат | Подпись MVP |
|---|---|---|
| macOS | `.dmg` раздельные `arm64` и `x64` (universal требует extra build steps, на MVP не делаем) | Без notarization. Коллега: right-click → Open. Notarization добавим если будет $99/год Apple Developer |
| Windows | `.exe` Setup (NSIS) + portable `.exe` | Без code-signing. SmartScreen: More info → Run anyway |
| Linux | `.AppImage` | Без подписи (стандарт) |

**GitHub Actions workflow `release.yml`:**
- Trigger: push tag `v*.*.*`
- Job matrix: `macos-latest`, `windows-latest`, `ubuntu-latest`
- Каждый: `npm ci`, `npm run build`, `npm run dist` (electron-builder)
- Артефакты прикрепляются к GitHub Release с тегом

**Версионирование:** semver, начиная с `0.1.0`.

**Auto-update:** не на MVP. В v2 — `electron-updater` с GitHub Releases provider.

## Структура репозитория

```
claude-config-tool/
├── .github/
│   └── workflows/
│       ├── ci.yml          # vitest на каждом push в main
│       └── release.yml     # build + GitHub Release на тег
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-06-claude-config-tool-design.md  ← этот файл
├── src/                    # см. Архитектура
├── tests/                  # vitest тесты для main/
├── electron.vite.config.ts
├── electron-builder.yml
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.node.json
├── vitest.config.ts
├── package.json
├── .gitignore
├── .prettierrc
├── .eslintrc.cjs
├── README.md               # что это, как поставить, скриншот
└── LICENSE                 # MIT (для публичного репо)
```

## Будущие расширения (не в MVP, для контекста архитектуры)

- **Onboarding wizard для коллеги** — отдельный route в renderer; визард: (1) выбрать пустую папку, (2) приложение клонирует шаблон-репо, (3) сканирует `~/.claude/`, предлагает что включить, (4) делает initial commit и push в новый GitHub repo (с авторизацией через GitHub OAuth device flow)
- **Управление настройками Claude Code из UI** — редактор `settings.json`, переключатели плагинов, hooks-визарды
- **Просмотр и редактирование memory** — list MEMORY.md, открытие отдельных feedback/project файлов в редакторе
- **Синхрон в обратную сторону** — `git push` после локальных изменений memory, с обнаружением диффа
- **Auto-update приложения** — `electron-updater` + GitHub Releases

Архитектура (раздельный main с runner.ts + IPC, расширяемый renderer) рассчитана на эти расширения без переделки.

## Открытые вопросы

- Имя репозитория: `claude-config-tool` — рабочее. Альтернативы: `ccsync`, `claude-cockpit`, `claudesync`. Решим перед `git remote add origin`.
- LICENSE: MIT по умолчанию для публичного репо. Подтвердим перед коммитом.
- Иконка приложения: пока заглушка из electron-builder, дизайн позже.
