// src/main/sync/manifest/synth.ts
import type { ClaudeConfig } from '@shared/api'
import type { Manifest, ManifestFileEntry } from './schema'
import { entryId } from './membership'

const GLOBAL_CATEGORIES = ['claudeMd', 'commands', 'skills', 'settings'] as const

/** Offered set synthesized from current config: all standard categories
 *  (activation is captured separately so toggling on later needs no manifest grow). */
export function synthManifest(cfg: ClaudeConfig): Manifest {
  const entries: ManifestFileEntry[] = []
  for (const c of GLOBAL_CATEGORIES) {
    entries.push({ kind: 'file', id: entryId('claude-global', c), surface: 'claude-global', category: c })
  }
  for (const p of cfg.projects) {
    entries.push({ kind: 'file', id: entryId('project', 'memory', p.name), surface: 'project', category: 'memory', project: p.name })
    entries.push({ kind: 'file', id: entryId('project', 'dotclaude', p.name), surface: 'project', category: 'dotclaude', project: p.name })
  }
  return { version: 1, entries }
}

/** 1:1 mapping of current toggles → device activation + known ids (migration). */
export function synthActivation(cfg: ClaudeConfig): { activation: Record<string, boolean>; knownEntryIds: string[] } {
  const activation: Record<string, boolean> = {
    [entryId('claude-global', 'claudeMd')]: cfg.syncGlobal.claudeMd,
    [entryId('claude-global', 'commands')]: cfg.syncGlobal.commands,
    [entryId('claude-global', 'skills')]: cfg.syncGlobal.skills,
    [entryId('claude-global', 'settings')]: cfg.syncGlobal.settings,
  }
  for (const p of cfg.projects) {
    activation[entryId('project', 'memory', p.name)] = p.syncMemory
    activation[entryId('project', 'dotclaude', p.name)] = p.syncDotClaude
  }
  return { activation, knownEntryIds: Object.keys(activation) }
}
