import type { BrowserWindow } from 'electron'
import pkg from 'electron-updater'
import { logUpdater } from './diag-log'

const { autoUpdater } = pkg

export type UpdateProgressEvent =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'not-available'; version: string }
  | { phase: 'downloading'; percent: number; transferred: number; total: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

let configured = false

/**
 * Configure electron-updater for Win + Linux. macOS is excluded — without an
 * Apple Developer ID the updater cannot verify the downloaded artifact, so
 * we use a separate brew-driven flow on darwin (see brew-updater.ts).
 */
export function setupAutoUpdater(window: BrowserWindow): void {
  if (configured) return
  if (process.platform === 'darwin') return
  configured = true

  // Don't auto-download on every check; the renderer triggers the download
  // explicitly via startUpdateDownload().
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

  const send = (event: UpdateProgressEvent) => {
    if (!window.isDestroyed()) window.webContents.send('update-progress', event)
  }

  autoUpdater.on('checking-for-update', () => {
    logUpdater('auto', 'checking-for-update')
    send({ phase: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    logUpdater('auto', 'update-available', { version: info.version })
    send({ phase: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    logUpdater('auto', 'update-not-available', { version: info.version })
    send({ phase: 'not-available', version: info.version })
  })
  autoUpdater.on('download-progress', (p) =>
    send({
      phase: 'downloading',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
    }),
  )
  autoUpdater.on('update-downloaded', (info) => {
    logUpdater('auto', 'update-downloaded', { version: info.version })
    send({ phase: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (e) => {
    const message = (e as Error).message ?? String(e)
    logUpdater('auto', 'error', { message })
    send({ phase: 'error', message })
  })
}

export async function checkForUpdates(): Promise<void> {
  if (process.platform === 'darwin') return
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // events already emitted above; swallow to keep IPC return non-throwing
  }
}

export async function startUpdateDownload(): Promise<void> {
  if (process.platform === 'darwin') return
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    /* event-driven */
  }
}

/**
 * After 'downloaded' event, replace running app with the freshly-downloaded
 * installer (NSIS on Win, AppImage on Linux). Quits this process. SmartScreen
 * does NOT trigger because the installer was downloaded by Node, not by a
 * browser, so it has no Mark-of-the-Web tag.
 */
export function quitAndInstall(): void {
  if (process.platform === 'darwin') return
  logUpdater('auto', 'quitAndInstall invoked', { execPath: process.execPath })
  autoUpdater.quitAndInstall(false /* isSilent */, true /* isForceRunAfter */)
}
