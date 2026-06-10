// src/main/sync/engine/safety-snapshot.ts
// Mechanical last line of defense: before ANY mutation of live user files
// (pull-apply, discard, resolve, cursor-install, plugin settings write) the
// operation preserves the files it is about to overwrite/delete into
// <userData>/safety-snapshots/<ts>-<op>/. Fail-closed: a preserve() error
// must abort the operation BEFORE the first mutation.
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'

const SNAP_DIR = 'safety-snapshots'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MIN_KEEP = 10

type SnapshotEntry = { original: string; stored: string; size: number; sha1: string }

export type SnapshotSession = {
  /** Copy current content of absPath into the session. Missing file → no-op.
   *  Throws on write failure — callers must NOT have mutated anything yet. */
  preserve(absPath: string): void
  /** Mark the session complete (manifest.done = true). */
  commit(): void
  readonly dir: string
}

export function beginSnapshot(userDataDir: string, opName: string): SnapshotSession {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(userDataDir, SNAP_DIR, `${ts}-${opName}`)
  const entries: SnapshotEntry[] = []
  let n = 0
  let created = false
  const writeManifest = (done: boolean): void => {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ op: opName, done, entries }, null, 2))
  }
  return {
    dir,
    preserve(absPath: string): void {
      if (!existsSync(absPath)) return
      const content = readFileSync(absPath)
      if (!created) {
        mkdirSync(join(dir, 'files'), { recursive: true })
        created = true
      }
      const stored = join(dir, 'files', `${n++}-${basename(absPath)}`)
      writeFileSync(stored, content)
      entries.push({
        original: absPath,
        stored,
        size: content.length,
        sha1: createHash('sha1').update(content).digest('hex'),
      })
      writeManifest(false) // manifest survives a crash mid-operation
    },
    commit(): void {
      if (!created) return // nothing preserved — no dir, nothing to mark
      writeManifest(true)
    },
  }
}

/** Rotation: delete sessions older than 30 days, but always keep the 10
 *  newest regardless of age. Called from sweepEngineState on app start. */
export function sweepSnapshots(userDataDir: string): void {
  const base = join(userDataDir, SNAP_DIR)
  if (!existsSync(base)) return
  let names: string[]
  try { names = readdirSync(base) } catch { return }
  // ISO timestamps sort lexicographically — newest last.
  names.sort()
  const candidates = names.slice(0, Math.max(0, names.length - MIN_KEEP))
  for (const name of candidates) {
    const abs = join(base, name)
    try {
      const st = statSync(abs)
      if (Date.now() - st.mtimeMs > MAX_AGE_MS) rmSync(abs, { recursive: true, force: true })
    } catch { /* best-effort */ }
  }
}
