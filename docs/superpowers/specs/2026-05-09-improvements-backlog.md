# Improvements backlog — claudesync v0.9.6 review

**Date:** 2026-05-09
**Source:** end-to-end UX walkthrough of two real-world flows on top of v0.9.6.
**Feature framing:** *"a tool to easily share AI configs between own devices / within a team"*. Suggestions are weighed against this product framing, not just internal correctness.

---

## Walkthroughs

### Scenario A — existing repo, new device

A user pushed config from machine A and now opens claudesync on machine B for the first time.

1. App opens. `repoUrl === null` → main screen shows **Initialize** + a link «or set in Settings if you already have a repo». [App.tsx:118-131](../../src/renderer/App.tsx)
2. User clicks the link → Settings opens on the **Repository** tab.
3. User pastes `repoUrl`, optionally edits `repoPath` in advanced (auto-suggested by URL hash).
4. Saves → `setConfig` writes to disk.
5. Status chip queries `getSyncStatus`. `isGitRepo(repoPath)` returns `false` because the path was never cloned → state = `no-remote`, chip hides. [sync-status.ts:9](../../src/main/sync-status.ts)
6. **Pull button never appears** — `behind === 0` permanently because there's no `.git` directory and `git fetch` never runs.
7. **Push doesn't work** — `runPush` calls `git status` in a non-git directory, returns nothing useful.

→ **Hard blocker.** The user must manually `git clone <url> <repoPath>` outside the app, after which the regular flow works. There is no in-app affordance for cloning an existing repo.

### Scenario B — fresh user, no repo, builds from scratch

1. Install app, sign in via GitHub device flow.
2. Click **Initialize**. Wizard runs: SignIn → RepoSettings → PreviewStep → ProgressStep (`init-local → generate → commit → create-remote → push`).
3. Wizard closes. `App.tsx` `onCompleted` reads new config; if no Claude path and no Cursor projects are configured, **Settings auto-opens**.
4. Settings opens on **Repository**. User has to figure out they should switch to **Claude** / **Cursor** tabs.
5. Claude tab: toggle enabled, path is usually auto-detected.
6. Cursor tab: empty state. User must register paths to their working repos manually.
7. On save, the regular sync-status pass runs exporters. `<repo>/claude/CLAUDE.md` etc. appear in the working tree. **Push** button surfaces.
8. Push → first commit with real data.

Works, but multi-step and discoverability is weak — the user lands on Repository, has to know the next move is Claude/Cursor tabs.

---

## Bottlenecks

### Hard blockers

1. **No "connect to existing repo" flow.** Scenario A is broken without manual `git clone`. Highest-impact gap.
2. **Init wizard is GitHub-only.** `createRepo` calls `api.github.com` directly. Teams on GitLab / Bitbucket / self-hosted can't use the wizard.

### UX / discoverability

3. **Empty sync tab with `repoUrl` but no targets** — single CTA «Открыть настройки» is okay, but the user doesn't yet know there are Claude/Cursor sub-tabs to drill into. Could deep-link to «Connect Claude» / «Connect Cursor».
4. **Cursor tab empty state doesn't preview unlinked repo subdirs.** The Add-project dialog has the suggestion chips, but the user has to open the dialog before seeing them. Should surface a hint in the tab itself: «N projects in repo not yet linked».
5. **Sync chip doesn't show last activity (who/when).** For a sharing tool, "who pushed last" matters more than abstract behind/ahead counts.
6. **Bootstrap `.gitkeep` lands in user's project repo.** Adding a Cursor project creates `<project>/.cursor/{rules,skills}/.gitkeep` — those are inside the user's working repo, surfacing as untracked there. Mild noise.

### Data / safety

7. **`settings.json` env-stripping is too narrow.** Only `parsed.env` is removed. Tokens in `mcpServers[].env` or any other nested location ship to the repo.
8. **Bootstrap doesn't update target project's `.gitignore`.** `<project>/.cursor/{rules,skills}/` will appear in the project's git status; user must self-manage exclusion.
9. **Cursor link-by-name is fragile.** Renaming a repo subdir or a registered project name silently breaks sync. Add-dialog suggestion chips help cross-machine (B), but no alert when an existing link diverges.
10. **Init wizard doesn't probe push permissions.** Pre-flight only checks repo existence via GET. Org users without push access fail at step 5 with the GitHub repo already created.

### Team-specific

11. **No "shared baseline + personal overlay" model.** Single repo = one mirror per user. Members merge each other's `settings.json` constantly. Layered configs (`shared/skills/` + `personal/<member>/settings.json`) would scale.
12. **Conflicts more frequent in teams.** Resolver works, but on shared `CLAUDE.md` two members hit rebase friction every push. Could ship a JSON/JSONL git merge driver for the synced files.
13. **No "teammate just pushed" signal.** Chip refreshes every 5 minutes (or on focus). For a team tool, push notifications via fetch-on-focus + toast «N changes from @user».
14. **No in-app activity log.** "Who changed what when" requires opening GitHub. Integrating `git log` into a panel or popover closes the loop.

### Architectural mini

15. **Legacy `runSync` IPC and handler unused** after the Pull refactor. Dead code; safe to remove.
16. **`scanLocalConfig` IPC is no longer called by InitWizard.** Kept "just in case"; candidate for removal or repurposing.
17. **`IGNORED_NAME` regex duplicated** across `claude.ts`, `cursor.ts`, `init-wizard.ts`. Extract to `src/main/sync/ignored.ts`.
18. **Plugin Manager (Plugins tab) is Claude-only.** Cursor plugin/rule catalog could be a natural extension of the existing catalog mechanism.

---

## Suggested changes — sorted by complexity (hard → easy)

Effort estimates assume a single experienced developer working with the existing patterns and tests.

### Hard (week+)

#### D. Layered config: shared baseline + personal overlay

Fundamental architectural shift. Repo gains two top-level layers:

```
<repo>/
├── shared/
│   ├── claude/...    (team-wide)
│   └── cursor/projects/...
└── personal/<machine-id>/
    ├── claude/settings.json   (api keys etc.)
    └── ...
```

**Touches:** schema, push-export with split (skills → shared, settings → personal), install-merge (shared first, personal overlay), conflict resolver, UI toggles per artifact, migration of existing single-layer repos, full test suite of layered scenarios.

**Estimate:** 2-3 weeks for MVP, +1 week UX polish.

#### J. Multi-VCS support (GitLab, Bitbucket, self-hosted)

Provider abstraction layer:

- `GitProvider` interface with concrete `GitHubProvider`, `GitLabProvider`, etc.
- OAuth flow per provider (different device-flow specs / scopes).
- API differences in `createRepo` / `repoExists` / `listOwners`.
- Token storage tagged by provider.
- UI: provider picker in init wizard.

**Estimate:** 1-1.5 weeks for two providers (GitHub + GitLab).

#### E. Invite-to-repo / one-click join

A new user-facing primitive. Two implementation paths:

- **Backend short-link**: requires hosting; out of scope.
- **Local share-link / QR**: serialize repo URL into a short string, register `claudesync://join?repo=<url>` deep-link in Electron, recipient pastes → auto-clone + setup.

Edge: invitee without push access needs a read-only fallback.

**Estimate:** 1 week (prefers deep-link approach).

### Medium (days)

#### F. Conflict pre-warning before push

Before opening the Push modal, run a background `git fetch`. If `behind > 0`, surface a banner «Колеги запушили N коммитов, сначала pull → resolve» with one-click pull. Power user can still «push anyway with rebase» (current behavior).

**Estimate:** 1-2 days.

#### H. Cursor plugins in catalog

Depends on whether Cursor has a standardized plugin source. As of v0.9.6 it doesn't — `.cursor/rules/*.mdc` and `.cursor/skills/<name>/SKILL.md` are just files. MVP would be a curated `awesome-cursor-rules`-style catalog with one-click install into registered Cursor projects.

**Estimate:** 3-5 days.

#### A. Connect to existing repo (clone flow)  ← Closes Scenario A

- New IPC `cloneRepo(url, path, token)` that runs `git clone` with auth headers.
- UI in **Settings → Repository**: "Clone now" button next to `repoPath` field, visible when `repoUrl` is set and the path is missing or non-git.
- After successful clone: call existing `checkInstallNeeded`; if true, set `installPending` so the Install button surfaces.
- Edge: path occupied but not a git repo → confirm before overwriting.

**Estimate:** 1 day. The single highest-leverage missing UX block.

#### C. Extended secret stripping

- Token-pattern detectors (`gho_*`, `sk-*`, `xoxb-*`, JWT, generic `[A-Za-z0-9_\-]{40,}` with high-FP confirm).
- Recursive walk over `settings.json` and `mcpServers[].env`.
- Push modal banner: «N possible secrets detected → preview / strip / cancel».
- "Known safe" allowlist to suppress noisy hashes/IDs.

**Estimate:** 2-3 days.

### Easy (hours)

#### B. Last activity in sync-status popover

- New IPC `getLatestActivity()` → `git log -1 origin/main --format='%an|%ar|%s'`.
- Render in `SyncStatusIndicator` popover: «Last update: @alice, 2h ago — fix CLAUDE.md».
- Cache 30s.

**Estimate:** 2-3 hours.

#### G. Add `**/.gitkeep` to `.gitignore.template`

One-line addition so bootstrap markers don't pollute users' repos.

**Estimate:** 5 minutes.

#### I. Cleanup of dead code

- Drop `runSync` IPC + `runSyncHandler` (no callers post-Pull refactor).
- Drop `scanLocalConfig` IPC + `scanClaudeConfig` if grep confirms no callers.
- Drop `generateGlobalStructure` re-export — back-compat no longer needed.
- Extract `IGNORED_NAME` regex to `src/main/sync/ignored.ts` (DRY).

**Estimate:** 1 hour.

---

## Strategic note: which direction to invest in

The product framing is **"share AI configs between own devices / within a team"**. The current implementation is solid for the **single-user multi-device** half. The team half is materially missing. Three structural pieces are needed before "team" is real:

1. **Layered config** (shared vs personal) — without it, teams collide on `settings.json` and API keys leak.
2. **Read-only / view-only mode** for members who pull baseline but shouldn't push. Auth model split.
3. **Activity signal** — without "who changed what when", the team feature is opaque and untrustworthy.

If the answer is "double down on single-user multi-device first" → ship A, B, C in that order (1-2 weeks of focused work, big UX delta). If the answer is "team-first now" → A is still required (Scenario A blocker), then D before E/F/H.

**Recommended sequence regardless of strategic choice:**

1. **A** (Connect existing repo) — 1 day, unblocks Scenario A.
2. **B** (Last activity in popover) — 3 hours, signal for both single-user and team.
3. **G + I** (gitignore .gitkeep + dead code cleanup) — 1 hour, hygiene.
4. **C** (Extended secret stripping) — 2-3 days, safety before "team" gets real.
5. **F** (Conflict pre-warning) — 1-2 days, reduces friction before D lands.
6. After this baseline → decide between **D** (deep team architecture) and **H/J** (broader reach).

---

## Per-fix file map (for whoever picks one up)

| Fix | Primary files |
|---|---|
| A. Clone existing repo | `src/main/ipc.ts` (new IPC), `src/shared/api.ts` + `src/preload/index.ts`, `src/renderer/components/Settings.tsx` (Repository tab) |
| B. Last activity | `src/main/sync-status.ts` (extend output), `src/renderer/components/SyncStatusIndicator.tsx` |
| C. Secret stripping | `src/main/sync/claude.ts` (`stripSecretsInClaudeRepo`), new helper `src/main/sync/secret-detect.ts`, `src/renderer/components/PushModal.tsx` |
| D. Layered config | schema (`src/shared/api.ts`), all of `src/main/sync/`, new `src/main/sync/layers.ts`, conflict resolver, full UI overhaul |
| E. Invite-to-repo | `src/main/index.ts` (deep-link registration), new `src/main/invite.ts`, new wizard step |
| F. Conflict pre-warning | `src/main/push.ts` or new IPC, `src/renderer/components/PushModal.tsx` open-handler |
| G. .gitkeep gitignore | `src/main/templates/gitignore.template` |
| H. Cursor plugins catalog | `src/main/catalog.ts`, `src/renderer/components/PluginsTab.tsx` |
| I. Dead code cleanup | `src/main/ipc.ts`, `src/main/init-wizard.ts`, new `src/main/sync/ignored.ts` |
| J. Multi-VCS | new `src/main/providers/`, refactor `src/main/github-api.ts`, init wizard |

---

## Out of scope (intentionally not listed above)

- **Mobile app / web app** — claudesync is desktop-only by design.
- **Real-time sync (websocket-style)** — push/pull rhythm is correct for config files. Real-time is overkill.
- **Encryption-at-rest** — git itself doesn't encrypt; if the user wants secrecy, private repo is the answer. Adding crypto layers complicates everything.
- **Plugin sandboxing** — out of scope; plugins inherit Claude's trust model.
