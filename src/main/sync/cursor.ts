import { existsSync, mkdirSync, statSync, readdirSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { CursorProject, LogLine } from '@shared/api'

const IGNORED_NAME = /^\.DS_Store$|^Thumbs\.db$/i

function syncDirMirror(src: string, dst: string): void {
  if (!existsSync(src)) {
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    return
  }
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst)) {
      if (IGNORED_NAME.test(entry) || !existsSync(join(src, entry))) {
        rmSync(join(dst, entry), { recursive: true, force: true })
      }
    }
  }
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (IGNORED_NAME.test(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    const stat = statSync(s)
    if (stat.isDirectory()) syncDirMirror(s, d)
    else cpSync(s, d)
  }
}

function copyFileIfExists(src: string, dst: string): void {
  if (!existsSync(src)) {
    // If source disappeared between pushes, drop the previously-copied file too.
    if (existsSync(dst)) rmSync(dst, { force: true })
    return
  }
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Export a single Cursor project's `.cursor/rules/`, `.cursor/skills/`, and
 * legacy `.cursorrules` into <repoPath>/cursor/projects/<project.name>/.
 *
 * If the project root no longer exists, emits a warning and leaves the
 * destination untouched (so a temporarily missing source doesn't delete
 * previously synced content).
 */
export function exportCursorProject(
  project: CursorProject,
  repoPath: string,
  emit?: (l: LogLine) => void,
): void {
  if (!existsSync(project.path)) {
    emit?.({
      time: nowHHMMSS(),
      text: `cursor: project "${project.name}" path missing (${project.path}) — skipping`,
      level: 'info',
    })
    return
  }
  const dest = join(repoPath, 'cursor', 'projects', project.name)
  const dotCursor = join(project.path, '.cursor')
  syncDirMirror(join(dotCursor, 'rules'), join(dest, 'rules'))
  syncDirMirror(join(dotCursor, 'skills'), join(dest, 'skills'))
  copyFileIfExists(join(project.path, '.cursorrules'), join(dest, '.cursorrules'))
}

export function exportCursorProjects(
  projects: CursorProject[],
  repoPath: string,
  emit?: (l: LogLine) => void,
): void {
  for (const p of projects) {
    exportCursorProject(p, repoPath, emit)
  }
}
