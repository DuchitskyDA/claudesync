import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { enumClaudeSource, readSourceForCommit } from './engine/source-enum'

export type ClaudeInstallMode = 'symlink' | 'copy'

/** Probe `<claudePath>/CLAUDE.md` — if it's a symbolic link we infer the
 *  user ran install.ps1/install.sh and is in symlink mode. Otherwise treat
 *  the install as a plain copy. */
export function detectClaudeInstallMode(claudePath: string): ClaudeInstallMode {
  const probe = join(claudePath, 'CLAUDE.md')
  if (!existsSync(probe)) return 'copy'
  try {
    if (lstatSync(probe).isSymbolicLink()) return 'symlink'
  } catch {
    /* ignore */
  }
  return 'copy'
}

/** Init-wizard variant: writes the initial Claude tree into <repoPath>/claude/
 *  using SyncRules (settings.json filtered to allow-list keys, canonical form).
 *  Uses Engine's enumClaudeSource so init-time and push-time agree on what gets
 *  synced and in what canonical form. */
export async function generateClaudeStructure(claudePath: string, repoPath: string): Promise<void> {
  mkdirSync(join(repoPath, 'claude'), { recursive: true })
  const entries = await enumClaudeSource(claudePath)
  for (const e of entries) {
    const srcAbs = join(claudePath, e.surfacePath)
    const dstAbs = join(repoPath, e.repoPath)
    mkdirSync(join(dstAbs, '..'), { recursive: true })
    const content = readSourceForCommit(srcAbs, e.surfacePath)
    writeFileSync(dstAbs, content)
  }
}
