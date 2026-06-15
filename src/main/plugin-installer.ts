// src/main/plugin-installer.ts
//
// Real plugin install/uninstall by shelling out to the official `claude plugin`
// CLI — the source of truth that writes ~/.claude/plugins/installed_plugins.json
// and clones marketplaces into plugins/marketplaces/. The previous approach only
// flipped `enabledPlugins` in settings.json, which never actually installed
// anything (and was disconnected from the real registry that `getInstalled`
// now reads).
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PluginEntry } from '@shared/api'
import { runCommand } from './runner'

/** Known absolute locations of the `claude` CLI. Electron's main process has a
 *  minimal PATH, so we probe explicit paths rather than relying on `which`. */
function claudeBinCandidates(): string[] {
  return [
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ]
}

export function findClaudeBin(): string | null {
  for (const p of claudeBinCandidates()) {
    if (existsSync(p)) return p
  }
  return null
}

// --- Pure argv builders (testable; no spawn) --------------------------------

export function installArgs(id: string): string[] {
  return ['plugin', 'install', id, '--scope', 'user']
}

export function uninstallArgs(id: string): string[] {
  return ['plugin', 'uninstall', id, '--scope', 'user']
}

export function marketplaceAddArgs(repo: string): string[] {
  return ['plugin', 'marketplace', 'add', repo]
}

/** Unique marketplace GitHub repos needed before installing `plugins`, in
 *  first-seen order. A plugin without a marketplace (bundled/official) yields
 *  nothing — `claude plugin install` resolves it from already-known sources. */
export function marketplaceReposFor(plugins: PluginEntry[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of plugins) {
    const repo = p.marketplace?.source.repo
    if (repo && !seen.has(repo)) {
      seen.add(repo)
      out.push(repo)
    }
  }
  return out
}

// --- Orchestrator -----------------------------------------------------------

export type CmdRunner = (
  bin: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

const defaultRunner: CmdRunner = (bin, args) =>
  runCommand(bin, args, { cwd: homedir(), onLine: () => { /* discard */ }, timeoutMs: 180_000 })

/** Add any required marketplaces (best-effort — re-adding an existing one is
 *  harmless), then install each `enable` plugin and uninstall each `disable`
 *  id. Collects per-id failures rather than aborting on the first. */
export async function runPluginInstalls(
  claudeBin: string,
  enable: PluginEntry[],
  disable: string[],
  runner: CmdRunner = defaultRunner,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []

  for (const repo of marketplaceReposFor(enable)) {
    // Best-effort: an "already added" non-zero exit must not block install,
    // and a genuinely broken marketplace surfaces as a clear install error.
    await runner(claudeBin, marketplaceAddArgs(repo))
  }

  for (const p of enable) {
    const r = await runner(claudeBin, installArgs(p.id))
    if (r.exitCode !== 0) {
      errors.push(`${p.id}: ${(r.stderr || r.stdout).trim() || 'install failed'}`)
    }
  }

  for (const id of disable) {
    const r = await runner(claudeBin, uninstallArgs(id))
    if (r.exitCode !== 0) {
      errors.push(`${id}: ${(r.stderr || r.stdout).trim() || 'uninstall failed'}`)
    }
  }

  return { ok: errors.length === 0, errors }
}
