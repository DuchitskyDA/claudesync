import { existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MAX_AGE_MS = 60 * 60 * 1000

/** Remove orphaned temp-index files left behind in `<repoPath>/.git/` by
 *  Engine push/resolve operations that crashed before reaching the
 *  `finally { rmSync(indexFile) }` block. Only deletes files matching
 *  `tmp-index*` that are older than one hour, so a concurrent active
 *  operation can't have its index swept out from under it. */
export function sweepEngineState(repoPath: string, _userDataDir: string): void {
  const gitDir = join(repoPath, '.git')
  if (!existsSync(gitDir)) return
  try {
    for (const name of readdirSync(gitDir)) {
      if (!name.startsWith('tmp-index')) continue
      const abs = join(gitDir, name)
      try {
        const st = statSync(abs)
        if (Date.now() - st.mtimeMs > MAX_AGE_MS) rmSync(abs, { force: true })
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
