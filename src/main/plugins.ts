import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type {
  ApplyPluginChanges,
  ClaudeTargetCheck,
  InstalledPluginsState,
} from '@shared/api'
import { beginSnapshot } from './sync/engine/safety-snapshot'

type ClaudeSettings = Record<string, unknown> & {
  enabledPlugins?: Record<string, boolean>
  extraKnownMarketplaces?: Record<string, { source: { source: string; repo: string } }>
  env?: Record<string, string>
}

function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export function settingsPathFor(rulesTarget: string): string {
  return join(expandTilde(rulesTarget), 'settings.json')
}

export function validateClaudeTarget(rulesTarget: string | null): ClaudeTargetCheck {
  if (!rulesTarget) return { ok: false, reason: 'Rules target not configured' }
  const expanded = expandTilde(rulesTarget)
  if (!isAbsolute(expanded)) return { ok: false, reason: 'Rules target must be absolute' }
  const settingsPath = join(expanded, 'settings.json')
  // Either file exists OR target dir exists (we'll create settings.json) OR neither (we'll create both on first apply)
  return { ok: true, settingsPath }
}

export function readClaudeSettings(settingsPath: string): ClaudeSettings {
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as ClaudeSettings
  } catch {
    return {}
  }
}

export function getInstalled(settingsPath: string): InstalledPluginsState {
  const s = readClaudeSettings(settingsPath)
  const marketplaceSources: Record<string, { source: string; repo: string }> = {}
  for (const [k, v] of Object.entries(s.extraKnownMarketplaces ?? {})) {
    if (v?.source) marketplaceSources[k] = v.source
  }
  return {
    enabledIds: Object.entries(s.enabledPlugins ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k),
    envSet: Object.keys(s.env ?? {}),
    knownMarketplaces: Object.keys(s.extraKnownMarketplaces ?? {}),
    marketplaceSources,
  }
}

export function applyChanges(
  settingsPath: string,
  changes: ApplyPluginChanges,
  userDataDir: string,
): { ok: boolean; error?: string } {
  let current: ClaudeSettings
  try {
    current = readClaudeSettings(settingsPath)
  } catch (e) {
    return { ok: false, error: `Cannot read settings: ${(e as Error).message}` }
  }

  const next: ClaudeSettings = { ...current }
  next.enabledPlugins = { ...(current.enabledPlugins ?? {}) }
  next.extraKnownMarketplaces = { ...(current.extraKnownMarketplaces ?? {}) }
  next.env = { ...(current.env ?? {}) }

  for (const plugin of changes.enable) {
    next.enabledPlugins[plugin.id] = true
    if (plugin.marketplace) {
      next.extraKnownMarketplaces[plugin.marketplace.id] = { source: plugin.marketplace.source }
    }
  }

  for (const id of changes.disable) {
    delete next.enabledPlugins[id]
  }

  for (const [k, v] of Object.entries(changes.envValues)) {
    if (v) next.env[k] = v
  }

  try {
    const session = beginSnapshot(userDataDir, 'plugins-apply')
    session.preserve(settingsPath)
    const tmp = `${settingsPath}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, settingsPath)
    session.commit()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Write failed: ${(e as Error).message}` }
  }
}
