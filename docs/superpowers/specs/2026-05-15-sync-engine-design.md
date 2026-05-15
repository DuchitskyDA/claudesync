# Sync Engine — design

**Status:** draft, awaiting user review
**Date:** 2026-05-15
**Owner:** brainstormed with the user, written by Claude Code

## Why

Текущий поток данных в [push.ts](../../../src/main/push.ts) / [ipc.ts](../../../src/main/ipc.ts) / [sync-status.ts](../../../src/main/sync-status.ts) производит фантомные diff'ы: после Pull пользователь видит «есть что push'ить», хотя ничего не менял.

Причины (см. systematic-debugging Phase 1):

1. `runEnabledExporters` ([ipc.ts:430](../../../src/main/ipc.ts:430)) запускается на каждом chip-refresh и **мутирует WT репо**, прокачивая `~/.claude` и Cursor projects в `<repoPath>/{claude,cursor}/`. Любое изменение в source (включая counters Claude'а вроде `numStartups`) мгновенно появляется в WT как diff против HEAD.
2. `~/.claude/projects/<path-hash>/memory/` использует hashes, зависящие от абсолютного пути проекта на конкретной машине. Каждая машина продуцирует свои уникальные hash-dirs, которые экспортируются в репо и видны как "untracked → нужно push'ить" на машинах, где их не было в HEAD.
3. `installClaudeSettings` ([claude.ts:288](../../../src/main/sync/claude.ts:288)) после Pull перезаписывает `~/.claude/settings.json` через `JSON.stringify(parsed, null, 2)`, теряя оригинальное форматирование, если оно отличалось от канонического.
4. Push ([push.ts:runPush](../../../src/main/push.ts:84)) внутри сам делает `git pull --rebase --autostash` в diverged-стете, что нарушает требование «никаких автоматических merge'ей».
5. `run-pull` ([ipc.ts:604](../../../src/main/ipc.ts:604)) не классифицирует конфликт-кейс из rebase'а — paused-rebase оставляет репо в half-state без UI для разрулиривания.

## Constraints (от пользователя)

1. **Никаких overwrites без апрува.** Source-дирки (`~/.claude`, Cursor projects) мутируются только при явном клике пользователя в preview-модалке.
2. **Diff показывается ТОЛЬКО если source реально расходится с HEAD.** Бэкграунд-экспорт в WT запрещён.
3. **Diverged state блокирует обе кнопки** (Pull, Push). Восстановление — только через per-file 3-way resolver.

## Decisions (закреплены в брейнсторме)

- **Diff baseline**: source vs HEAD (последний commit). WT — транзитная зона, пользователь её не видит.
- **Sync rules**: code defaults + UI override. v1 поставляет defaults в коде; UI override — отдельный план (v2).
- **Resolver UX**: per-file 3-way merge (расширение существующего ConflictModal). Choice per file: keep mine / take remote / manual edit. Apply пишет в source и одновременно создаёт merge commit.
- **Mechanism**: pure git plumbing. WT всегда = HEAD. Push строит temp git index без записи в WT. Pull = fetch + preview + явный Apply.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  UI (Sync tab, PushModal, PullModal, Resolver)   │
└────────────────────┬─────────────────────────────┘
                     │ IPC (compare / push / pull / resolve)
┌────────────────────▼─────────────────────────────┐
│            Sync Engine                           │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ SyncRules  │ │ Comparator │ │ Resolver     │  │
│  └────────────┘ └────────────┘ └──────────────┘  │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ SourceEnum │ │ HeadEnum   │ │ IndexBuilder │  │
│  └────────────┘ └────────────┘ └──────────────┘  │
│  ┌────────────┐ ┌────────────┐                   │
│  │ PullApply  │ │ GitOps     │                   │
│  └────────────┘ └────────────┘                   │
└──────────────────────────────────────────────────┘
       │                                  │
       ▼                                  ▼
   ~/.claude                          <repoPath>/.git
   .cursor/                           (WT всегда = HEAD)
```

### Modules

| Module | Responsibility | Depends on | Does NOT depend on |
|---|---|---|---|
| `SyncRules` | Effective sync-list: top-level entries (sync/ignore) + settings.json key allow-list. Чистая функция от defaults + cfg overrides. | `cfg.syncRules` | fs, git |
| `SourceEnum` | Walk source dir; apply SyncRules; return `{relPath, sha1, mode, size}[]`. Для settings.json: parse → filter по allow-list → канонизировать → hash. | SyncRules, fs | git |
| `HeadEnum` | То же из HEAD: `git ls-tree -r HEAD <prefix>`. Settings.json в HEAD уже канонизирован — этот инвариант поддерживается всеми write-путями. | GitOps | fs, SyncRules |
| `Comparator` | Два списка → `{path, status: 'added'\|'modified'\|'deleted'\|'same', sourceSha?, headSha?}[]`. Чистая функция. | — | — |
| `IndexBuilder` | Строит temp git index через `GIT_INDEX_FILE`. `hash-object -w --stdin` для блобов + `update-index --add --cacheinfo`. WT не трогается. | GitOps | UI |
| `GitOps` | Тонкая обёртка над git CLI: `ls-tree`, `cat-file`, `hash-object -w`, `update-index`, `write-tree`, `commit-tree`, `update-ref`, `fetch`, `push`, `merge-base`, `read-tree`, `checkout-index`. Авторизация для remote-операций. | env, fs | UI |
| `PullApply` | Для каждого {srcPath, content}: write to source (mkdir + writeFile). Additive: не удаляет local-only файлы. Settings.json special-case: merge filtered keys из HEAD + preserve env + volatile в source. | GitOps, fs | UI |
| `Resolver` | State трёхстороннего merge: base/mine/theirs. Принимает per-file choice; при Apply пишет в source через PullApply + строит two-parent merge commit через IndexBuilder. Персистит state в `<userData>/sync-engine/resolve.json`. | Comparator, IndexBuilder, PullApply | UI |

### Invariants

1. **WT всегда = HEAD** в состоянии покоя. Любая операция, временно мутирующая WT, обязана восстановить инвариант через `git checkout-index -af` до возврата.
2. **Source мутируется только через PullApply или Resolver-Apply**, и только после явного подтверждения в preview.
3. **HEAD/origin не двигаются без explicit push** (явный клик).
4. **Compare — чистый read.** Нет побочных эффектов на disk.

### Sync rules — defaults

**Claude top-level entries (синкаем):**
- `CLAUDE.md` — file
- `settings.json` — file, special case (filtered)
- `commands/` — dir, mirror
- `skills/` — dir, mirror
- `projects/<hash>/memory/` — dir, mirror (только memory; sessions и пр. игнорируются)

**Claude игнорируем:**
- `plugins/`, `history.jsonl`, `sessions/`, `cache/`, `.credentials.json`, `settings.local.json`, `ide/`, `statsig/`, `*.backup.*`, `.DS_Store`, `Thumbs.db`, `projects/<hash>/sessions/`, `projects/<hash>/*.jsonl`.

**Settings.json key allow-list (sync):**
- `permissions`, `hooks`, `mcpServers`, `theme`, `statusLine`, `autoCompactEnabled`, `includeCoAuthoredBy`, `model`, `outputStyle`, `verbose`, `cleanupPeriodDays`, `forceLoginMethod`, `awsAuthRefresh`, `awsCredentialExport`, `enableArchitectTool`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `apiKeyHelper`, `additionalDirectories`.

**Settings.json игнорируем (volatile/secret):**
- `env` — секрет, локален per-machine
- `numStartups`, `cachedChangelog`, `lastReleaseNotesSeen`, `tipsHistory`, `oauthAccount`, `firstStartTime`, `userID`, `installMethod`, `autoUpdaterStatus`, `lastReleaseNotesViewed`, `recommendedSubscription`, `subscriptionNoticeCount`, `hasCompletedOnboarding`, `lastOnboardingVersion`, `customApiKeyResponses`, `previousVersion` — telemetry/state.

**Cursor projects (синкаем):**
- `.cursor/rules/` — dir, mirror
- `.cursor/skills/` — dir, mirror
- `.cursorrules` — file

## Data flows

### Compare (chip refresh)

Триггер: интервал 60с, focus, явный Refresh button. Никаких записей на disk.

```
refreshStatus():
  srcClaude   = SourceEnum(cfg.claude.path)
  headClaude  = HeadEnum('claude/')
  diffClaude  = Comparator(srcClaude, headClaude)

  for proj in cfg.cursor.projects:
    srcProj   = SourceEnum(proj.path)
    headProj  = HeadEnum(`cursor/projects/${proj.name}/`)
    diffProj  = Comparator(srcProj, headProj)

  GitOps.fetch(origin)                  // timeout 8s; offline → state='offline'
  ahead  = rev-list --count origin/main..HEAD
  behind = rev-list --count HEAD..origin/main

  localChanges = sum across diffs of (added + modified + deleted)
  state =
    behind > 0 && localChanges > 0       → 'diverged'
    behind > 0                            → 'behind'
    localChanges > 0 && ahead == 0        → 'local-changes'
    ahead > 0                             → 'ahead'
    else                                  → 'in-sync'

  return { state, behind, ahead, localChanges, diffs, fetchedAt }
```

### Push

```
compute-push-preview:
  status = refreshStatus()
  if status.state == 'diverged' → return { kind: 'diverged' }  // UI opens Resolver
  return status.diffs                                          // UI opens PushModal

execute-push(commitMessage):
  GitOps.fetch(origin)
  if origin/main != HEAD → return { kind: 'stale', retry: true }

  tmpIndex = <userData>/sync-engine/index.${pid}.${ts}
  try:
    GIT_INDEX_FILE=tmpIndex git read-tree HEAD
    for each diff (added/modified):
      sha = git hash-object -w --stdin <<< canonicalContent(srcFile)
      GIT_INDEX_FILE=tmpIndex git update-index --add --cacheinfo 100644,${sha},${repoPath}
    for each deleted:
      GIT_INDEX_FILE=tmpIndex git update-index --force-remove ${repoPath}

    treeSha = GIT_INDEX_FILE=tmpIndex git write-tree
    if treeSha == HEAD^{tree} → return { kind: 'nothing-to-push' }
    commitSha = git commit-tree treeSha -p HEAD -m commitMessage
    git update-ref refs/heads/main commitSha
  finally:
    rm tmpIndex

  GitOps.syncWtToHead()                 // git read-tree HEAD; git checkout-index -af
  push = git push origin main
  if push fails non-fast-forward:
    git update-ref refs/heads/main <prev-HEAD>     // rollback
    syncWtToHead()
    return { kind: 'race', retry: true }
  return { kind: 'ok' }
```

### Pull

```
compute-pull-preview:
  status = refreshStatus()
  if status.state == 'diverged' → return { kind: 'diverged' }
  if status.behind == 0          → return { kind: 'nothing-to-pull' }

  remoteDiff = git diff --raw HEAD..origin/main -- claude/ cursor/
  preview[]: для каждой записи:
    {repoPath, srcPath, status, currentSrcContent?, newContent}

  return { kind: 'preview', items: preview }

execute-pull-apply(deletionsToApply: string[]):
  for each preview item:
    switch item.status:
      case 'added':     write item.newContent to item.srcPath
      case 'modified':  if repoPath == 'claude/settings.json':
                          mergeSettings(item.newContent, item.srcPath)
                        else:
                          write item.newContent to item.srcPath
      case 'deleted':   if item.repoPath ∈ deletionsToApply:
                          unlink item.srcPath
                        else:
                          skip  // остаётся local-only

  git merge --ff-only origin/main      // двигает HEAD; WT обновляется git'ом
  return { kind: 'ok' }

mergeSettings(newBlobContent, srcPath):
  newParsed = JSON.parse(newBlobContent)        // только allow-list ключи
  currentParsed = JSON.parse(read(srcPath))
  result = { ...currentParsed }                 // start from local (preserves volatile + env)
  for key in ALLOW_LIST:
    if key in newParsed: result[key] = newParsed[key]
    else: delete result[key]                    // removed in HEAD
  write(srcPath, JSON.stringify(result, null, 2))
```

### Resolver (diverged)

```
compute-resolver-state:
  baseSha = git merge-base HEAD origin/main
  conflictPaths = union of:
    - paths from (source vs HEAD) diff
    - paths from (HEAD vs origin/main) diff
  for each path:
    base    = git cat-file blob ${baseSha}:${repoPath} || null
    mine    = read source(${srcPath}) || null      // canonicalized для settings.json
    theirs  = git cat-file blob origin/main:${repoPath} || null
  state = [{ path, base, mine, theirs, choice: null }, ...]
  persist to <userData>/sync-engine/resolve.json
  return state

// UI per-file picks: choice ∈ {'mine', 'theirs', 'manual'} + editedContent for 'manual'

execute-resolve(commitMessage, resolutions[]):
  final = {} // path → string | null
  for each res:
    final[res.path] =
      res.choice == 'mine'   ? res.mine
    : res.choice == 'theirs' ? res.theirs
                              : res.editedContent

  // 1. write source
  for each path:
    if final[path] == null: unlink srcPath(path)
    else:                   write final[path] to srcPath(path)

  // 2. build merge commit
  tmpIndex = <userData>/sync-engine/index.${pid}.${ts}
  try:
    // 3-way aggressive: автоматически разрешает пути, где один из бортов
    // не менялся (file unchanged on one side). Конфликтующие пути остаются
    // unmerged stage'ами в индексе — мы их перезаписываем через update-index.
    GIT_INDEX_FILE=tmpIndex git read-tree -m --aggressive ${baseSha} HEAD origin/main
    for each path in conflictPaths:
      if final[path] != null:
        sha = git hash-object -w --stdin <<< final[path]
        update-index --add --cacheinfo 100644,${sha},${repoPath}
      else:
        update-index --force-remove ${repoPath}

    treeSha   = write-tree
    commitSha = git commit-tree treeSha -p HEAD -p origin/main -m commitMessage
    git update-ref refs/heads/main commitSha
  finally:
    rm tmpIndex
    rm <userData>/sync-engine/resolve.json

  syncWtToHead()
  git push origin main
```

## Error handling & recovery

| Scenario | Behaviour |
|---|---|
| Crash mid-Push, after update-ref, before push | HEAD двинут, remote отстаёт. Следующий refreshStatus: `ahead > 0`. UI: Push снова доступен. |
| Crash mid-Push, before update-ref | tmp-index осиротел; sweep при старте удаляет `<userData>/sync-engine/index.*` старше 1 часа. Objects в .git без рефа — git gc подметёт. HEAD не двинут. |
| Crash mid-PullApply | HEAD не двинут (merge --ff-only ещё не выполнен). Source частично обновлён. Следующий refreshStatus: source ≠ HEAD (частично) + origin впереди → diverged. Пользователь идёт через Resolver. Данные не теряются. |
| Crash mid-Resolve | `resolve.json` персистится после каждого choice. При старте: если файл есть → диалог "Continue resolving previous merge? / Discard". |
| `git push` non-fast-forward | Rollback `update-ref` к prev HEAD, sweep tmp-index, syncWtToHead, refreshStatus → пользователь увидит обновлённый diverged. |
| Network error на fetch | `state: 'offline'`, последний snapshot с пометкой "stale". Push заблокирован до восстановления. |
| Auth error | Surface + deeplink в Settings → Sign in. |
| Settings.json unparseable в source | SourceEnum: `{ ..., error: 'unparseable' }`. Comparator исключает из счётчика. UI: warning + ссылка на файл. |
| Settings.json unparseable в HEAD | HeadEnum: same. UI: warning "remote settings.json corrupt — manual fix needed". |
| File > 5 MB в source | Skip + warning. Защита от случайного `*.jsonl` в `~/.claude`. |
| Symlink-loop в source | catch + skip в SourceEnum. |

**Startup sweep (`<userData>/sync-engine/`):**
- `index.*` старше 1 часа → удалить
- `resolve.json` → диалог "resume / discard"

## Testing

### Unit (vitest, no fs)
- `SyncRules`: defaults, override merging, settings.json allow-list filter.
- `Comparator`: каждый статус (added/modified/deleted/same), пустые входы.
- Settings.json canonicalization: idempotent, key order preserved, volatile keys dropped.

### Integration (vitest + tmpdir git repo)
- **No phantom diff after pull** (регрессионный тест на текущий баг): remote update → fetch → pullApply → refreshStatus → state == 'in-sync', localChanges == 0.
- **Roundtrip stability**: SourceEnum → IndexBuilder → write-tree → HeadEnum даёт тот же hash.
- **Push idempotency**: повторный push без изменений → 'nothing-to-push'.
- **Diverged detection**: source modify + remote ahead → state == 'diverged'.
- **Resolver round-trip**: simulate diverged → resolve mix mine/theirs/manual → итоговый tree корректен, two-parent commit.
- **Crash recovery**: kill mid-pull-apply → restart → sweep + retry → success.
- **Settings.json**: numStartups change → 'same'; permission added → 'modified'.
- **Cursor projects**: то же параллельно.
- **Symlink mode**: file в ~/.claude — symlink на WT → modify через ~/.claude → compare detects через inode.

### E2E (Playwright manual checklist)
- Two-machine flow: Mac push → Windows pull → ~/.claude корректен, чип "in sync".
- Diverged → Resolver → Apply → commit имеет двух родителей.
- Cancel Pull preview → ~/.claude нетронут.
- Cancel Resolver → resolve.json удалён, state снова 'diverged'.

## Out of scope (v1)

- UI редактор sync-rules — отдельный план (v2).
- Авто-watcher на ~/.claude — chip обновляется по таймеру + focus.
- Reset migration: при первом запуске новой версии после установки, если в WT есть pending mutations от старой версии, делаем одноразовый `git reset --hard HEAD` под confirmation modal.
- Удаление файлов в source при Pull, когда remote их удалил — в v1 по умолчанию НЕ применяется (отображается в preview с unchecked чекбоксом).

## Replacements in existing code

| Удаляется / переписывается | Заменяется на |
|---|---|
| [ipc.ts:runEnabledExporters](../../../src/main/ipc.ts:430) — auto-export на каждом chip refresh | удалить полностью |
| [push.ts:runPush](../../../src/main/push.ts:84) — export → pull-rebase → commit → push в одном жесте | Engine.executePush — без auto-pull-rebase |
| [ipc.ts:run-pull](../../../src/main/ipc.ts:604) — git pull --rebase + auto installClaude | Engine.computePullPreview + Engine.executePullApply (две стадии) |
| [ipc.ts:discard-local-changes](../../../src/main/ipc.ts:660) | переименовано в `discard-source-changes`; работает через PullApply (записывает HEAD's content в source), не `git checkout` |
| [sync-status.ts:getSyncStatus](../../../src/main/sync-status.ts:119) | Engine.refreshStatus |
| [sync/claude.ts:exportClaude](../../../src/main/sync/claude.ts:160), `installClaude`, `stripSecretsInClaudeRepo` | удалить; функциональность переехала в Engine |
| [sync/cursor.ts](../../../src/main/sync/cursor.ts), [sync/cursor-install.ts](../../../src/main/sync/cursor-install.ts) | удалить; функциональность переехала в Engine |
| [conflict.ts](../../../src/main/conflict.ts) — на основе git rebase paused state | переписан под Engine.Resolver (base/mine/theirs из наших источников, не из rebase index) |
| [push.ts:classifyPullError](../../../src/main/push.ts:34) | остаётся как утилита для GitOps |
| init-wizard `generateClaudeStructure` ([claude.ts:196](../../../src/main/sync/claude.ts:196)) | переписан под SyncRules: settings.json фильтруется по allow-list (не только `env` дропается), commands/skills/projects/memory копируются по тем же правилам что и Engine.SourceEnum. Это поддерживает инвариант «HEAD's settings.json содержит только allow-list keys и канонизирован». |
