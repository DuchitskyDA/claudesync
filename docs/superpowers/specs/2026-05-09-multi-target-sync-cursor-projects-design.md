# Multi-target sync: Claude + Cursor projects

**Status:** draft
**Date:** 2026-05-09
**Target version:** 0.9.0

## Goal

Add Cursor as a second sync subject alongside Claude Code. The two are independent features with their own logic, UI tab, and repo layout — not a unified abstraction. Users can enable either, both, or neither.

This spec scopes Phase A only. MCP sync, Cursor user-level rules (SQLite), Codex, and VSCode-style settings are explicit non-goals — see "Non-goals" below.

## Why

The user's company team uses Cursor; deploying claudesync at work requires Cursor support. Cursor and Claude expose configuration through fundamentally different mechanisms (Claude: dot-folder of plain files; Cursor: project-scoped artifacts in `.cursor/` plus a SQLite-backed user store), so a unified `SyncTarget[]` schema would force false symmetry. Treating each tool as its own feature, with its own tab and its own exporter, keeps the codebase honest and the user model simple.

## Non-goals

The following are deliberately deferred. Implementing any of them in this phase expands scope and is out of bounds:

- **MCP sync** for any tool — handled by a separate future feature, including `~/.cursor/mcp.json` and the `mcpServers` block of `~/.claude.json`.
- **Cursor user-level rules** stored in `<AppData>/Cursor/User/globalStorage/state.vscdb` — requires SQLite adapter, deferred to Phase B.
- **VSCode-style Cursor settings** (`%APPDATA%\Cursor\User\settings.json`, etc.) — out of scope.
- **Codex** as a sync subject — deferred to Phase D; schema does not reserve fields for it.
- **Cursor project skills/rules without a registered project** — only paths the user explicitly registers are synced; no auto-scan of `~/code/` or similar.
- **Symlink install mode** for Cursor — copy mode only.
- **Bidirectional sync of Cursor project artifacts back into project repos** — Phase A only writes from disk into the claudesync repo; pulling Cursor artifacts back into project repos is not in scope.
- **Plugin catalog support for Cursor** — `getInstalledPlugins`, `applyPluginChanges` continue to operate against the Claude target only.

## Architecture

Two independent feature modules under `src/main/sync/`:

- `src/main/sync/claude.ts` — extracted from existing `push.ts`/`init-wizard.ts` Claude-specific logic, no behavioral change
- `src/main/sync/cursor.ts` — new module for Cursor projects

The push pipeline becomes:

```ts
async function runPush(cfg: AppConfig, repoPath: string) {
  if (cfg.claude.enabled && cfg.claude.path) {
    exportClaude(cfg.claude.path, repoPath)
  }
  if (cfg.cursor.enabled) {
    exportCursorProjects(cfg.cursor.projects, repoPath)
  }
  // git add/commit/push as before
}
```

No shared dispatcher, no shared whitelist table. Each exporter knows its own source layout, its own destination subdir, and its own whitelist. Adding a third tool (e.g. Codex in Phase D) means adding a third module and a third `if`-branch.

## Data model

### Config schema

```ts
type AppConfig = {
  // unchanged:
  repoPath: string | null
  repoUrl: string | null
  includeSecretsInPush: boolean
  locale: 'en' | 'ru' | null
  lastDismissedUpdate: string | null

  // refactored — replaces rulesTarget:
  claude: {
    enabled: boolean
    path: string | null     // absolute, e.g. ~/.claude (expanded)
  }
  cursor: {
    enabled: boolean
    projects: CursorProject[]
  }

  // legacy, migrated on read, never written:
  rulesTarget?: string | null
}

type CursorProject = {
  name: string    // user-visible label, e.g. "myapp"
  path: string    // absolute path to project root
}
```

### Migration on read

`readConfig` performs a one-shot upgrade in memory:

1. If parsed JSON has `claude` and `cursor` blocks — use as-is.
2. Else if it has legacy `rulesTarget: string`:
   ```ts
   claude = { enabled: true, path: rulesTarget }
   cursor = { enabled: false, projects: [] }
   ```
3. Else (fresh install or null `rulesTarget`):
   ```ts
   claude = { enabled: false, path: detectClaudeTarget() }  // null if ~/.claude doesn't exist
   cursor = { enabled: false, projects: [] }
   ```

`writeConfig` writes the new shape only. The legacy `rulesTarget` field is not preserved on save — once a 0.9.0 user calls `setConfig`, the field disappears from disk.

### Validation rules

- `claude.path` — if not null, must be absolute (after `expandTilde`)
- `cursor.projects[].path` — absolute, must exist as a directory at validation time
- `cursor.projects[].name` — non-empty, valid directory name on all supported OS (no `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, no leading/trailing whitespace, not `.` or `..`), unique within the array (used as repo subdir)
- Two projects with the same `path` are rejected as duplicates
- Two projects with the same `name` are rejected as duplicates

## Repo layout

```
<repo>/
├── global/                  # Claude — kept as-is from 0.8.x for zero-friction upgrade
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── commands/
│   ├── skills/
│   └── projects/            # memory only, not full project state
└── cursor/
    └── projects/
        ├── myapp/
        │   ├── .cursorrules
        │   ├── rules/
        │   └── skills/
        └── another-project/
            └── ...
```

The Claude folder name `global/` is preserved from 0.8.x. The asymmetry with `cursor/` is intentional: existing repos keep working with no migration step, and "global" still reads sensibly as "user-global Claude config" alongside "per-project Cursor configs". No in-app migration code, no manual `git mv` required.

## Cursor exporter

For each registered project in `cfg.cursor.projects`:

1. Resolve `<dest> = <repoPath>/cursor/projects/<project.name>/`
2. Mirror `<project.path>/.cursor/rules/` → `<dest>/rules/` (recursive)
3. Mirror `<project.path>/.cursor/skills/` → `<dest>/skills/` (recursive)
4. Copy file `<project.path>/.cursorrules` → `<dest>/.cursorrules` (if present; legacy)

Mirror semantics: same as existing `syncDirMirror` in `push.ts` — destination is wiped of files not present in source. This keeps removed skills/rules from sticking around in the repo.

Sources that don't exist on the project side are skipped silently; the destination subdir is created only if at least one source produced output.

If the project's `path` no longer exists on disk at push time, the exporter logs a warning (via the existing `emit` channel) and skips that project — the existing destination subdir under `<repo>/cursor/projects/<name>/` is left untouched (not wiped), so a temporarily missing source (e.g. unmounted external drive) does not delete previously synced content from the repo. The project entry is not auto-removed from the config — the user removes it manually in Settings, which on the next push results in the destination subdir staying in the repo until the user deletes it manually with `git rm`.

## Claude exporter

Mechanically identical to today's `exportRulesToRepo`, just relocated to `src/main/sync/claude.ts` and parameterized on `(claudePath, repoPath)`. Destination remains `<repoPath>/global/`. No behavioral change inside the Claude module.

## UI

Settings refactor into three tabs:

### Tab "Repository"

Existing per-repo and global settings: `repoUrl`, `repoPath`, GitHub auth, `includeSecretsInPush`, `locale`, update dot dismissal. No new fields.

### Tab "Claude"

- Toggle: `claude.enabled` (master switch for Claude sync)
- Path input: `claude.path` with `Detect` button (same UX as today's `suggestRulesTarget`)
- Status: number of files that would be synced, validation errors

Equivalent to today's single-target Settings page, just isolated to its own tab.

### Tab "Cursor"

- Toggle: `cursor.enabled` (master switch for Cursor sync)
- List of registered projects:
  ```
  Cursor projects
  ─────────────────────────────────────────
  [myapp]              ~/code/myapp     [×]
  [another-project]    ~/code/another   [×]

  [+ Add project]
  ─────────────────────────────────────────
  ```
- "Add project" opens a small dialog with two fields: `name`, `path` (with directory picker)
- Validation errors render inline under the offending row
- Empty state when `projects.length === 0`: a hint "No Cursor projects registered. Click Add project to start."

The list is purely user-managed in Phase A — no auto-detection of Cursor projects from disk. Users register what they want to sync.

## Init wizard

The wizard gains a target-selection step, placed after repo selection and before commit:

```
What to sync
─────────────────────────────────────────
[✓] Claude Code     ~/.claude    (24 files)
[ ] Cursor projects (configure later)
─────────────────────────────────────────
[Back]                       [Continue]
```

- Claude row: checkbox auto-checked iff `~/.claude` exists; path read-only here, edited in Settings later
- Cursor row: checkbox is informational only — checked or not, the wizard does not configure Cursor projects (registering project paths is a manual Settings activity)

Rationale: the wizard's job is to get a working repo on disk with a first commit. Cursor project registration is fundamentally a "tell me which paths to track" decision the user makes deliberately, not as part of an init flow.

If the user unchecks Claude here, the wizard creates an empty repo (or with only Cursor placeholder if/when Cursor wizard support is added later); the first push happens manually after configuration.

## IPC changes

| Today | After |
|---|---|
| `getConfig(): AppConfig` (with `rulesTarget`) | `getConfig(): AppConfig` (with `claude`, `cursor`) |
| `setConfig(cfg)` | `setConfig(cfg)` — validates new shape |
| `detectRulesTarget()` | `detectClaudeTarget()` — same logic, renamed |
| `suggestRulesTarget()` | `suggestClaudePath()` — same logic, renamed |
| `validateClaudeTarget()` | `validateClaudeTarget()` — unchanged |
| `scanLocalConfig()` | `scanClaudeConfig()` — same logic, renamed |
| — | `pickCursorProjectPath(): Promise<string \| null>` — directory picker for Add project dialog |
| — | `validateCursorProject(p: { name: string; path: string }): ValidationResult` |

`InitWizardOptions` drops `rulesTarget: string` and gains `claude: { enabled: boolean; path: string | null }`. Cursor-related options are not in `InitWizardOptions` (the wizard doesn't configure Cursor projects).

The renderer's `useAppState` hook drops `rulesTarget` and exposes `claude` and `cursor` blocks instead.

## Plugin catalog

`getPluginCatalog`, `getInstalledPlugins`, `applyPluginChanges`, `validateClaudeTarget` continue to operate against `cfg.claude.path` only. The plugin UI is not Cursor-aware. If `cfg.claude.enabled` is false or `cfg.claude.path` is null, the plugin tab returns an empty/disabled state with a hint pointing at the Claude tab.

## Conflict resolver

The git-level conflict resolver is unchanged. Conflicts in `cursor/projects/<name>/rules/file.mdc` are resolved through the same `ConflictState` flow as conflicts in `claude/CLAUDE.md`. No new conflict UI needed.

## Sync status

`getSyncStatus` and `refreshSyncStatus` work at the git level (behind/ahead counts) and remain unchanged. They count commits regardless of which subdir was modified.

## Cross-platform

All Phase A paths are home-directory-rooted or user-supplied:

- `~/.claude` resolves via `homedir()` on every OS.
- Cursor project paths are user-supplied and platform-agnostic.

No platform-specific code is introduced in this phase. The platform-specific Cursor user store (`state.vscdb` under `Library/Application Support/` on macOS, `%APPDATA%` on Windows) is a Phase B concern.

## Testing

At minimum:

- **Config migration test** — given a 0.8.x-shaped config object on disk with `rulesTarget: "/tmp/dotclaude"`, `readConfig` returns the new shape with `claude.enabled: true`, `claude.path: "/tmp/dotclaude"`, `cursor.enabled: false`, `cursor.projects: []`.
- **Config write test** — after `setConfig`, the on-disk JSON contains no `rulesTarget` field.
- **Cursor exporter test** — given a fake project tree with `.cursorrules`, `.cursor/rules/a.mdc`, `.cursor/skills/x/SKILL.md`, exporter produces the expected mirror under `<repo>/cursor/projects/<name>/`.
- **Cursor exporter mirror semantics test** — file removed from source on second push is removed from destination.
- **Cursor exporter missing-source test** — registered project whose path no longer exists is skipped without aborting the run.
- **Settings render test** — Cursor tab with empty `projects` shows the empty state; with two projects shows two rows.
- **Validation test** — adding a Cursor project with a duplicate `path` or non-existent directory yields a validation error.

Existing Claude tests are preserved as-is; the Claude exporter is moved but not changed.

## Decisions

- **Folder name** — `global/` is kept for the Claude target (no rename). Zero-friction upgrade for existing 0.8.x repos.
- **Wizard's "Cursor projects" row** — kept as an informational placeholder in the wizard. Selecting it has no effect in Phase A; full Cursor wizard support arrives later. The row signals to first-time users that Cursor sync exists and where to find it (Settings → Cursor).
