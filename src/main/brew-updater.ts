import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { UpdateProgressEvent } from './auto-updater'

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
  if (!brew) {
    send({ phase: 'error', message: 'brew_not_found' })
    return
  }

  send({ phase: 'downloading', percent: 10, transferred: 0, total: 0 })

  // 1. Refresh taps so the latest cask version is visible locally.
  const update = await runBrew(brew, ['update', '--quiet'], window)
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
  let throttle = Date.now()
  const upgrade = await runBrew(
    brew,
    ['upgrade', '--cask', 'claudesync', '--no-quarantine'],
    window,
    () => {
      const now = Date.now()
      if (now - throttle > 250) {
        throttle = now
        send({ phase: 'downloading', percent: 70, transferred: 0, total: 0 })
      }
    },
  )

  if (upgrade.code !== 0) {
    send({
      phase: 'error',
      message: `brew upgrade failed (exit ${upgrade.code ?? 'null'}):\n${upgrade.out.trim().slice(-400)}`,
    })
    return
  }

  const lower = upgrade.out.toLowerCase()
  const noop =
    lower.includes('already installed') ||
    lower.includes('no available upgrade') ||
    lower.includes('no casks to upgrade')
  if (noop) {
    send({
      phase: 'error',
      message:
        'Homebrew reports the cask is already at the latest known version. ' +
        'The new release may still be propagating to the tap — try again in a minute.',
    })
    return
  }

  send({ phase: 'downloaded', version: '' })
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 800)
}
