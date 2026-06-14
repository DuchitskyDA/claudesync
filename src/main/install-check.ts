import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type InstallCheckOpts = {
  repoPath: string | null
  claudeEnabled: boolean
  claudePath: string | null
  cursorEnabled: boolean
  cursorProjects: { name: string; path: string }[]
}

/** True when the repo holds content that is NOT yet present in the install
 *  targets — i.e. running install would actually deploy something. Unlike a
 *  bare "repo has content" check, this stays false once a machine is set up,
 *  so the Install prompt doesn't nag on every launch. Mirrors the surfaces the
 *  install script links: claude {settings.json, CLAUDE.md, commands/*,
 *  skills/*, projects/<name>/memory} and each cursor project's top-level. */
export function isInstallNeeded(opts: InstallCheckOpts): boolean {
  const { repoPath } = opts
  if (!repoPath) return false

  if (opts.claudeEnabled && opts.claudePath) {
    const repoClaude = join(repoPath, 'claude')
    const target = opts.claudePath
    for (const f of ['settings.json', 'CLAUDE.md']) {
      if (existsSync(join(repoClaude, f)) && !existsSync(join(target, f))) return true
    }
    if (anyChildMissing(join(repoClaude, 'commands'), join(target, 'commands'))) return true
    if (anyChildMissing(join(repoClaude, 'skills'), join(target, 'skills'))) return true
    const repoProjects = join(repoClaude, 'projects')
    if (existsSync(repoProjects)) {
      for (const name of safeReaddir(repoProjects)) {
        if (existsSync(join(repoProjects, name, 'memory')) && !existsSync(join(target, 'projects', name, 'memory'))) {
          return true
        }
      }
    }
  }

  if (opts.cursorEnabled) {
    for (const p of opts.cursorProjects) {
      const repoProj = join(repoPath, 'cursor', 'projects', p.name)
      if (anyChildMissing(repoProj, p.path)) return true
    }
  }

  return false
}

/** True if `repoDir` has any child (ignoring .gitkeep) absent under `targetDir`. */
function anyChildMissing(repoDir: string, targetDir: string): boolean {
  if (!existsSync(repoDir)) return false
  for (const name of safeReaddir(repoDir)) {
    if (name === '.gitkeep') continue
    if (!existsSync(join(targetDir, name))) return true
  }
  return false
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
