import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname } from 'node:path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { UpdateProgressEvent } from './auto-updater'
import { logUpdater } from './diag-log'

const BREW_CANDIDATES = [
  '/opt/homebrew/bin/brew', // Apple Silicon default
  '/usr/local/bin/brew', // Intel default
  '/home/linuxbrew/.linuxbrew/bin/brew', // Linuxbrew (not used here, but harmless)
]

export function findBrew(): string | null {
  for (const p of BREW_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return null
}

export function isBrewAvailable(): boolean {
  return findBrew() !== null
}

/**
 * Walk up from an executable path until we hit a `*.app` directory; return
 * its basename. Pure (no fs), exported for tests.
 */
export function extractAppBundleName(execPath: string): string | null {
  let p = execPath
  while (p !== '/' && p !== dirname(p)) {
    if (p.endsWith('.app')) return basename(p)
    p = dirname(p)
  }
  return null
}

/**
 * Resolve the `.app` bundle path to relaunch after a brew cask upgrade.
 *
 * `app.relaunch()` defaults to `process.execPath`, which on macOS Node passes
 * through `realpath()`. For a brew cask whose `/Applications/<name>.app` is a
 * symlink into the Caskroom (e.g. `/opt/homebrew/Caskroom/<name>/<old>/<name>.app`),
 * that realpath points to the *old* version dir — which `brew upgrade --cask`
 * removes before installing the new one. Relaunching that path either fails
 * silently or makes LaunchServices resurrect the cached running bundle, so the
 * user ends up looking at the same old version.
 *
 * Solution: launch the canonical `/Applications/<name>.app` (or
 * `~/Applications/<name>.app`) symlink, which brew has just repointed at the
 * new version, via `/usr/bin/open -n`.
 *
 * Exported for tests.
 */
export function findAppBundleForRelaunch(
  execPath: string,
  fileExists: (p: string) => boolean = existsSync,
): string | null {
  const appName = extractAppBundleName(execPath)
  if (!appName) return null
  const candidates = [
    `/Applications/${appName}`,
    `${homedir()}/Applications/${appName}`,
  ]
  for (const c of candidates) {
    if (fileExists(c)) return c
  }
  return null
}

type SpawnResult = { code: number | null; out: string }

function runBrew(
  brew: string,
  args: string[],
  window: BrowserWindow,
  onProgress?: () => void,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(brew, args, {
      env: { ...process.env, HOMEBREW_NO_ANALYTICS: '1' },
    })
    let out = ''
    const collect = (chunk: Buffer) => {
      out += chunk.toString()
      onProgress?.()
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (e) => {
      resolve({ code: -1, out: out + e.message })
    })
    child.on('exit', (code) => resolve({ code, out }))
    void window // referenced to keep the param stable; events go via outer caller
  })
}

/**
 * Run `brew update && brew upgrade --cask claudesync` from inside the app,
 * streaming progress to the renderer. On success, quits and relaunches —
 * brew has already swapped the .app bundle.
 *
 * Detects the "already installed" no-op so we don't silently relaunch the
 * same version when the cask hasn't been bumped on the tap yet (which
 * happens for ~30s after a release while CI's bump-cask job is still running).
 */
export async function runBrewUpgrade(window: BrowserWindow): Promise<void> {
  const brew = findBrew()
  const send = (e: UpdateProgressEvent) => {
    if (!window.isDestroyed()) window.webContents.send('update-progress', e)
  }
  logUpdater('brew', 'runBrewUpgrade start', {
    appVersion: app.getVersion(),
    execPath: process.execPath,
    brew,
  })
  if (!brew) {
    send({ phase: 'error', message: 'brew_not_found' })
    return
  }

  send({ phase: 'downloading', percent: 10, transferred: 0, total: 0 })

  // 1. Refresh taps so the latest cask version is visible locally.
  const update = await runBrew(brew, ['update', '--quiet'], window)
  logUpdater('brew', 'brew update done', {
    code: update.code,
    tail: update.out.trim().slice(-400),
  })
  if (update.code !== 0) {
    send({
      phase: 'error',
      message: `brew update failed (exit ${update.code ?? 'null'}):\n${update.out.trim().slice(-400)}`,
    })
    return
  }

  send({ phase: 'downloading', percent: 40, transferred: 0, total: 0 })

  // 2. Upgrade the cask. brew prints "already installed" when the local cask
  //    points to a version that's already on disk — treat that as an error so
  //    the UI doesn't pretend an update happened.
  //
  //    Note: do NOT pass `--no-quarantine` here. Recent brew versions have
  //    disabled the flag and exit 1 with "Calling the `--[no-]quarantine`
  //    switch is disabled!". Quarantine is stripped by the cask's own
  //    postflight (`xattr -cr <app>` in `Casks/claudesync.rb`), so the flag
  //    was redundant anyway.
  let throttle = Date.now()
  const upgrade = await runBrew(
    brew,
    ['upgrade', '--cask', 'claudesync'],
    window,
    () => {
      const now = Date.now()
      if (now - throttle > 250) {
        throttle = now
        send({ phase: 'downloading', percent: 70, transferred: 0, total: 0 })
      }
    },
  )
  // Tail-truncated to keep the log readable; full stdout/stderr can be huge.
  logUpdater('brew', 'brew upgrade done', {
    code: upgrade.code,
    tail: upgrade.out.trim().slice(-2000),
  })

  if (upgrade.code !== 0) {
    send({
      phase: 'error',
      message: `brew upgrade failed (exit ${upgrade.code ?? 'null'}):\n${upgrade.out.trim().slice(-400)}`,
    })
    return
  }

  const noop = isBrewNoOp(upgrade.out)
  logUpdater('brew', 'no-op check', { noop })
  if (noop) {
    send({
      phase: 'error',
      message:
        'Homebrew reports the cask is already at the latest known version. ' +
        'The new release may still be propagating to the tap — try again in a minute.',
    })
    return
  }

  logUpdater('brew', 'sending downloaded event, scheduling relaunch')
  send({ phase: 'downloaded', version: '' })
  setTimeout(() => {
    relaunchAfterBrewUpgrade()
  }, 800)
}

/**
 * brew prints various wordings when a cask doesn't actually need upgrading.
 * Treat all of them as no-op so we don't relaunch on top of an unchanged
 * bundle and pretend an update happened.
 *
 * Exported for tests.
 */
export function isBrewNoOp(output: string): boolean {
  const lower = output.toLowerCase()
  const patterns = [
    'already installed',
    'no available upgrade',
    'no casks to upgrade',
    'nothing to upgrade',
    'is up-to-date',
    'are up-to-date',
    '0 outdated packages',
  ]
  return patterns.some((p) => lower.includes(p))
}

/**
 * Mac-specific relaunch after `brew upgrade --cask` has swapped the bundle.
 * Prefers `/usr/bin/open -n <bundle>` over `app.relaunch()` because the
 * latter execs `process.execPath`, which is the (now-deleted) Caskroom
 * realpath — see `findAppBundleForRelaunch` for the long story.
 */
function relaunchAfterBrewUpgrade(): void {
  const bundle = findAppBundleForRelaunch(process.execPath)
  logUpdater('brew', 'relaunch', {
    execPath: process.execPath,
    bundle,
    method: bundle ? 'open -n' : 'app.relaunch (fallback)',
  })
  if (bundle) {
    spawn('/usr/bin/open', ['-n', bundle], {
      detached: true,
      stdio: 'ignore',
    }).unref()
  } else {
    // Last resort — only fires when the canonical /Applications/<name>.app
    // symlink is missing (e.g. exotic HOMEBREW_CASK_OPTS --appdir).
    app.relaunch()
  }
  app.exit(0)
}
