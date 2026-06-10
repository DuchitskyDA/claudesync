import { existsSync, mkdirSync, statSync, readdirSync, readFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { CursorProject, LogLine } from '@shared/api'
import { beginSnapshot, type SnapshotSession } from './engine/safety-snapshot'

const IGNORED_NAME = /^\.DS_Store$|^Thumbs\.db$/i

type PlannedCopy = { src: string; dst: string; preserveNeeded: boolean }

/**
 * Phase A – collect: walk src recursively and build a flat list of planned
 * file copies. No mutations happen here.
 */
function collectDirCopies(src: string, dst: string, out: PlannedCopy[]): void {
  if (!existsSync(src)) return
  for (const entry of readdirSync(src)) {
    if (IGNORED_NAME.test(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    const stat = statSync(s)
    if (stat.isDirectory()) collectDirCopies(s, d, out)
    else {
      out.push({
        src: s,
        dst: d,
        preserveNeeded: existsSync(d) && !readFileSync(d).equals(readFileSync(s)),
      })
    }
  }
}

function collectFileCopy(src: string, dst: string, out: PlannedCopy[]): void {
  if (!existsSync(src)) return
  out.push({
    src,
    dst,
    preserveNeeded: existsSync(dst) && !readFileSync(dst).equals(readFileSync(src)),
  })
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
 *
 * Fail-closed: all preserve() calls complete before any cpSync so that a
 * snapshot error leaves live files untouched (spec §3.3).
 */
export function installCursorProject(
  repoPath: string,
  project: CursorProject,
  session: SnapshotSession,
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

  // Phase A – collect all planned copies (no mutations)
  const planned: PlannedCopy[] = []
  collectDirCopies(join(src, 'rules'), join(destDotCursor, 'rules'), planned)
  collectDirCopies(join(src, 'skills'), join(destDotCursor, 'skills'), planned)
  collectFileCopy(join(src, '.cursorrules'), join(project.path, '.cursorrules'), planned)

  // Phase B – preserve all differing-overwrite targets BEFORE any mutation
  for (const p of planned) {
    if (p.preserveNeeded) session.preserve(p.dst)
  }

  // Phase C – create destination dirs and copy files
  for (const p of planned) {
    mkdirSync(join(p.dst, '..'), { recursive: true })
    cpSync(p.src, p.dst)
  }

  emit?.({
    time: nowHHMMSS(),
    text: `cursor: installed "${project.name}" -> ${project.path}/.cursor/`,
    level: 'success',
  })
}

export function installCursorProjects(
  repoPath: string,
  projects: CursorProject[],
  userDataDir: string,
  emit?: (l: LogLine) => void,
): void {
  const session = beginSnapshot(userDataDir, 'cursor-install')
  for (const p of projects) installCursorProject(repoPath, p, session, emit)
  session.commit()
}
