# Cross-device normalization of `~/.claude/projects/<encoded>` paths

**Date:** 2026-05-15
**Status:** Draft — pending approval

## Problem

Claude Code stores per-project memory under `~/.claude/projects/<encoded-abs-path>/memory/...`. The encoded segment differs per device (`/Users/foo/myrepo` → `-Users-foo-myrepo`; `C:\Users\Foo\myrepo` → `-C--Users-Foo-myrepo`). Today our push uses that segment verbatim as the repo key, so the same logical project ends up under two unrelated paths in the repo and never merges.

## The repo structure that already exists

`init-wizard.ts` + `install.sh.template` already define a canonical layout:

```
claude/
  CLAUDE.md
  settings.json
  commands/
  skills/
  projects/<NAME>/memory/...      ← human-readable per-project key
cursor/
  projects/<NAME>/{.cursorrules, .cursor/...}   ← same model, explicit user-chosen name
```

`install.sh` reads `claude/projects/*/memory` and creates symlinks at `$CLAUDE_DIR/projects/<NAME>/memory`. Cursor projects already require the user to register `(name, absLocalPath)` in settings. Today's push is the only piece that doesn't honor this contract — it emits `claude/projects/<encoded>/memory/...` instead of `claude/projects/<name>/memory/...`.

The goal: bring push in line with the structure the rest of the system already assumes.

## Three options

### Option A — Same registration model as Cursor (recommended)

Treat claude-projects like cursor-projects: the user explicitly registers each project they want synced. Settings shape mirrors Cursor:

```json
"claude": {
  "enabled": true,
  "path": "~/.claude",
  "projects": [
    { "name": "myproject",   "path": "/Users/foo/myproject" },
    { "name": "ERP-Front",   "path": "/Users/foo/work/erp" }
  ]
}
```

**Push:** walk `~/.claude/projects/<encoded>/memory/...`; decode `<encoded>` → abs path; find a registered project whose `path` matches → emit under `claude/projects/<name>/memory/...`. If no match, skip (with a one-shot log line so the user knows).

**Pull:** see `claude/projects/<name>/memory/...` in repo; look up registered `path`; encode to `<encoded>`; write to `~/.claude/projects/<encoded>/memory/...` on this device. If `<name>` is not registered locally, skip.

**Onboarding helper (small UX piece):** on first launch, scan `~/.claude/projects/*` for entries with memory content and offer "Register N detected projects?" with a default name = decoded basename. User can rename or skip per row. After that, the standard Settings panel manages the list.

- ✅ Repo stays consistent with the install/init contract (`<name>` works for memory just like it works for Cursor).
- ✅ Symmetric with Cursor — one mental model, one settings schema, one UI section.
- ✅ Human-readable repo tree.
- ✅ Cross-OS safe.
- ❌ User registers projects once per device (mitigated by the detection helper).

### Option B — Auto-derive ID from git remote

ID = `sha12(origin-url) + "--" + basename`. Fully automatic when the project has a git remote; fall back to basename for projects without one.

- ✅ Zero registration friction.
- ❌ Asymmetric with Cursor (two different mental models in one app).
- ❌ Doesn't handle projects without a git remote elegantly.
- ❌ Repo paths read like `9f2a4e1c7b5d--myproject` — harder to scan.

### Option C — Auto-detect with editable names

Hybrid: app detects projects locally (default name = basename), but user can rename them. Same on-disk storage as A (registered list in settings). Difference is only in the seeding flow — A asks per project on first sync, C pre-fills with auto-detected names and shows them all at once.

Effectively A and C converge in steady-state; C is just "A with a smarter initial wizard."

## Decision: Option C

The engine + settings store match Option A (registered `{name, path}` list, symmetric with Cursor). The seeding is automatic:

- **At startup and whenever the app detects unregistered local data**, scan `~/.claude/projects/*` for entries with memory content. For each, decode the segment → abs path → default `name = basename(absPath)`. Auto-register them (no modal, no blocking UI).
- **Settings panel** lets the user rename a project, fix its `path` if auto-detection guessed wrong, or detach (unregister) a project — detaching means "don't sync this anymore," it does not touch on-disk data.
- **Name collision on auto-register**: if `basename` already exists, suffix with a short hash of the abs path (`myproject-a1b2`).
- **Same-name across devices** stays the user's responsibility — names are the contract, so Mac and Win should agree on the same `name` for the same logical project. The Settings UI displays both `name` and `path` so the user can tell what's what.

## Implementation plan (if Option A is approved)

1. **Schema** (`config.ts`, `src/shared/api.ts`):
   - Add `claude.projects: ClaudeProject[]` where `ClaudeProject = { name: string; path: string }`.
   - Validate names (same rules as Cursor: no `/`, `\`, `<>:"|?*`, non-empty, not `.`/`..`).
   - Default `[]`. Backward-compatible with existing configs.

2. **Encoding helpers** (`src/main/sync/engine/rules.ts`):
   - `decodeClaudeProjectSegment(encoded) → absLocalPath` (reverse of Claude Code's encoding).
   - `encodeClaudeProjectSegment(absLocalPath) → encoded` (forward for pull).
   - Handle Windows: `C:\...` ↔ `-C--...`. Cross-platform unit-tested.

3. **Push** (`source-enum.ts`):
   - When walking `~/.claude/projects/<encoded>/memory/...`, decode → abs path → find registered project.
   - If found, emit `repoPath = "claude/projects/" + name + "/memory/" + rest`, keep `surfacePath = "projects/" + encoded + "/memory/" + rest`.
   - If not found, skip + log "unregistered project memory at <abs>; add it in Settings to sync".

4. **Pull / Resolver / pull-apply** (`engine.ts`, `resolver.ts`):
   - When parsing `claude/projects/<name>/memory/<rest>`, look up registered project; encode its `path` → use as on-disk segment. Treat as "skip" if not registered on this device (same code path as unregistered Cursor projects today).

5. **Settings UI** (`src/renderer/components/Settings.tsx`):
   - Add a "Claude projects" section mirroring the existing Cursor projects section: name input, path input, validate, add/remove rows.

6. **Migration** (one-shot):
   - On first launch after upgrade, if the repo has any `claude/projects/<x>/memory/` where `<x>` looks like an encoded path (starts with `-` and contains no `/`), surface a one-time banner: "Project memory in the repo uses old per-machine paths. Rename them once and they'll sync across devices." Banner links to Settings.
   - Renaming is a manual Push from the user once they've registered the project with a clean name. We don't auto-rewrite the repo to keep this PR focused.

7. **Tests**:
   - Round-trip encode/decode on macOS- and Windows-shaped paths.
   - Push emits `claude/projects/<name>/...` when registered, skips when not.
   - Pull writes to `~/.claude/projects/<encoded>/...` when registered, skips when not.
   - Resolver paths align cross-device given matching `(name → path)` mappings on both sides.

8. **Templates**:
   - `install.sh.template` and `install.ps1.template` already work with `<name>` and need no change. README can gain a one-line note: "claude/projects/<name>/memory is symlinked to ~/.claude/projects/<encoded>/memory based on the project mapping in this app's Settings."

## Open questions

1. **Detection wizard** at first launch — ship now or follow-up? (Recommendation: follow-up; manual add-in-Settings is enough for v1.)
2. **What happens to existing `claude/projects/<encoded>` data in repos already in use?** It stays there until the user registers the project and pushes; then the new `<name>` entries land and the user can manually delete the stale `<encoded>` ones via a regular `Discard`/branch cleanup. We don't auto-migrate to avoid surprising deletions.
3. **Name collisions across devices** (Mac registers as `myproject`, Win registers as `MyProject`): treat as different projects, since names are the contract. Document this clearly in the Settings UI label.
