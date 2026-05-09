import type { CursorProject, LocalizedMessage } from '@shared/api'
import { validateCursorProject } from '../config'

export type ProjectListValidation =
  | { ok: true }
  | { ok: false; index: number; error: LocalizedMessage }

export function validateCursorProjects(projects: CursorProject[]): ProjectListValidation {
  const seenNames = new Set<string>()
  const seenPaths = new Set<string>()
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    const r = validateCursorProject(p)
    if (!r.ok) return { ok: false, index: i, error: r.error }
    if (seenNames.has(p.name)) {
      return {
        ok: false,
        index: i,
        error: { key: 'cursor.error.duplicateName', params: { name: p.name } },
      }
    }
    if (seenPaths.has(p.path)) {
      return {
        ok: false,
        index: i,
        error: { key: 'cursor.error.duplicatePath', params: { path: p.path } },
      }
    }
    seenNames.add(p.name)
    seenPaths.add(p.path)
  }
  return { ok: true }
}

export { validateCursorProject }
