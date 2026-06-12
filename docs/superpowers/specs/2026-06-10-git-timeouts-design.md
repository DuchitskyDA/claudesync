# Git timeouts in sync engine — design

Date: 2026-06-10. Source: final code review of the data-safety changeset.

## Problem

Engine git calls run without timeouts (except `fetchOrigin`, 8s SIGKILL). A hung
git process (credential prompt edge case, dead NFS, antivirus lock, network
black hole) never settles its promise, so the op holding the FIFO op-lock
(`src/main/sync/engine/op-lock.ts`) never releases it. `isLocked()` stays true
forever, `refresh-sync-status` returns busy, UI freezes permanently.

## Decisions

- `runGit` (git-ops.ts) gets `timeoutMs` option, default **30 000 ms** for all
  local plumbing. On timeout: `SIGKILL`, reject with `GitTimeoutError`
  (`git <args> timed out after Nms`).
- `pushOrigin` passes **60 000 ms** (network op, large pushes legal). A
  `GitTimeoutError` is converted to `{ ok: false, stderr: <message> }`, flowing
  through the existing `classifyRemoteError` → `{ kind: 'error' }` path. Other
  rejections (spawn `error`) propagate unchanged.
- Inline `spawn` in `computePullPreview` (engine.ts) is replaced by a new
  `diffRawZ(repoPath, range, prefixes)` helper in git-ops.ts using `runGit` —
  identical command, env, and error message (`git diff exit N: <stderr>`), now
  with the default timeout.
- `fetchOrigin` keeps its 8s semantics; it only gains the lock cleanup below.

## Windows lock cleanup

SIGKILL on Windows (TerminateProcess) can leave `.git/*.lock` files. After the
killed process actually exits, `cleanupStaleGitLocks(repoPath, sinceMs,
indexFile?)` best-effort unlinks a fixed candidate list (`index.lock`,
`packed-refs.lock`, `config.lock`, `HEAD.lock`, `shallow.lock`,
`refs/heads/main.lock`, `refs/remotes/origin/main.lock`, plus
`<GIT_INDEX_FILE>.lock` when the op used a temp index) — **only** when the lock
mtime is newer than our spawn start (minus 2s clock slack), so locks owned by a
concurrent manual git are never touched. Leftover locks cause fast failures,
not hangs, so cleanup is QoL, не корректность.

## Why rejection is enough for the op-lock

`withExclusiveLock` decrements `pending` in `finally`; only a never-settling
promise starves the queue. A timely rejection both frees the lock and surfaces
`{ kind: 'error' }` (or an IPC rejection identical to today's git-failure path).

## Non-goals

- No semantic changes to existing operations (same commands, env, messages).
- No retry logic; no configurable timeouts in UI.

## Tests

`tests/main/engine/git-ops-timeout.test.ts`, real git + a local silent HTTP
server (accepts requests, never responds) to make fetch/push hang:

1. `runGit` against the silent server with `timeoutMs: 500` → rejects with
   `GitTimeoutError`, message contains `timed out`.
2. `pushOrigin` with origin → silent server, 500 ms → `{ ok: false, stderr:
   /timed out/ }`.
3. `cleanupStaleGitLocks`: fresh lock removed; lock older than `since` kept;
   missing files tolerated; `<indexFile>.lock` removed.
4. Integration: lock file created while `runGit` hangs is removed after the
   timeout kill.
5. `diffRawZ` returns parseable `--raw -z` output between two commits.
