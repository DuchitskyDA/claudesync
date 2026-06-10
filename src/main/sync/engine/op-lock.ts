// src/main/sync/engine/op-lock.ts
// Single in-process FIFO mutex for ALL mutating sync operations (engine push/
// pull/discard/resolve, install, init-repo, legacy run-sync). Electron main is
// a single process and the app holds a single-instance lock, so an in-process
// queue is sufficient — no on-disk lock files (those rot after crashes).

let queue: Promise<unknown> = Promise.resolve()
let pending = 0

/** True while any exclusive operation is running or queued. Read-only status
 *  refresh must skip (return the cached snapshot) while this is true. */
export function isLocked(): boolean {
  return pending > 0
}

/** Run `fn` exclusively. Concurrent calls queue FIFO. The opName parameter is
 *  for diagnostics only. */
export function withExclusiveLock<T>(_opName: string, fn: () => Promise<T>): Promise<T> {
  pending++
  const run = queue.then(async () => {
    try {
      return await fn()
    } finally {
      pending--
    }
  })
  // Swallow errors on the chain so one failed op doesn't poison the queue;
  // the caller still gets the rejection from `run`.
  queue = run.then(() => undefined, () => undefined)
  return run
}
