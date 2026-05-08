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

/**
 * Run `brew upgrade --cask claudesync` silently from inside the app, streaming
 * stdout/stderr to the renderer as `update-progress` events. On success, quits
 * the app and relaunches; brew has already swapped the .app bundle, so the
 * fresh process picks up the new version.
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

  send({ phase: 'downloading', percent: 0, transferred: 0, total: 0 })

  return new Promise<void>((resolve) => {
    const child = spawn(brew, ['upgrade', '--cask', 'claudesync'], {
      env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1' },
    })
    let buffered = ''
    let lastSent = Date.now()
    const onLine = (chunk: Buffer) => {
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      const now = Date.now()
      // throttle events to roughly 5/s
      if (now - lastSent > 200) {
        const last = lines.filter(Boolean).pop()
        if (last) {
          send({
            phase: 'downloading',
            percent: 50, // brew doesn't expose progress; show indeterminate
            transferred: 0,
            total: 0,
          })
        }
        lastSent = now
      }
    }
    child.stdout?.on('data', onLine)
    child.stderr?.on('data', onLine)
    child.on('error', (e) => {
      send({ phase: 'error', message: e.message })
      resolve()
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        send({
          phase: 'error',
          message: `brew exited with code ${code ?? 'null'}`,
        })
        resolve()
        return
      }
      send({ phase: 'downloaded', version: '' })
      // Give the renderer a tick to display the success state, then relaunch.
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 800)
      resolve()
    })
  })
}
