// src/main/sync/manifest/membership.ts
import type { ManifestEntry, ManifestSurface, ManifestCategory } from './schema'

/**
 * Category of a surface-relative path under ~/.claude (the enumClaudeSource walk).
 * Covers both claude-global top-level entries and per-project memory
 * (projects/<encoded>/memory/...). Returns null for anything else.
 * NOTE: the hard ignore floor (rules.isClaudePathIgnored) is applied by the
 * caller BEFORE this; this function only classifies category membership.
 */
export function globalPathCategory(rel: string): ManifestCategory | null {
  const norm = rel.replace(/\\/g, '/')
  if (norm === 'CLAUDE.md') return 'claudeMd'
  if (norm === 'settings.json') return 'settings'
  if (norm.startsWith('commands/')) return 'commands'
  if (norm.startsWith('skills/')) return 'skills'
  if (/^projects\/[^/]+\/memory\//.test(norm)) return 'memory'
  return null
}

/** Stable entry id for a (surface, category, project?). */
export function entryId(surface: ManifestSurface, category: ManifestCategory, project?: string): string {
  return surface === 'claude-global'
    ? `claude-global:${category}`
    : `project:${project}:${category}`
}

/** Is there an active manifest entry with this id? */
export function hasActiveEntry(id: string, active: ManifestEntry[]): boolean {
  return active.some((e) => e.id === id)
}
