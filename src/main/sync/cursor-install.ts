import { existsSync, mkdirSync, statSync, readdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { CursorProject, LogLine } from '@shared/api'

const IGNORED_NAME = /^\.DS_Store$|^Thumbs\.db$/i

/**
 * Additive copy: overwrite files that exist on both sides, but **never**
 * remove entries from `dst` that aren't present in `src`. Reverse-mirror
 * (repo → project) must not destroy the user's local-only files; that's
 * what made Discard turn into a data-loss action before this fix.
 */
function syncDirCopy(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (IGNORED_NAME.test(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    const stat = statSync(s)
    if (stat.isDirectory()) syncDirCopy(s, d)
    else cpSync(s, d)
  }
}

function copyFileIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Install a single Cursor project from sync-repo back into the project's
 * own .cursor/ folder. Mirrors rules/, skills/ and copies .cursorrules with
 * overwrite semantics — any uncommitted changes the user had in their
 * project's .cursor/ will surface as `git status` modifications in that
 * project's own repo, where the user resolves them.
 *
 * Skips silently if the source subdir doesn't exist in sync-repo (project
 * was registered but never pushed) or the destination project path
 * disappeared on disk.
 */
export function installCursorProject(
  repoPath: string,
  project: CursorProject,
  emit?: (l: LogLine) => void,
): void {
  if (!existsSync(project.path)) {
    emit?.({
      time: nowHHMMSS(),
      text: `cursor: project "${project.name}" path missing (${project.path}) — skipping install`,
      level: 'info',
    })
    return
  }
  const src = join(repoPath, 'cursor', 'projects', project.name)
  if (!existsSync(src)) {
    emit?.({
      time: nowHHMMSS(),
      text: `cursor: no synced data for "${project.name}" in repo — skipping install`,
      level: 'info',
    })
    return
  }
  const destDotCursor = join(project.path, '.cursor')
  syncDirCopy(join(src, 'rules'), join(destDotCursor, 'rules'))
  syncDirCopy(join(src, 'skills'), join(destDotCursor, 'skills'))
  copyFileIfExists(join(src, '.cursorrules'), join(project.path, '.cursorrules'))
  emit?.({
    time: nowHHMMSS(),
    text: `cursor: installed "${project.name}" -> ${project.path}/.cursor/`,
    level: 'success',
  })
}

export function installCursorProjects(
  repoPath: string,
  projects: CursorProject[],
  emit?: (l: LogLine) => void,
): void {
  for (const p of projects) {
    installCursorProject(repoPath, p, emit)
  }
}
