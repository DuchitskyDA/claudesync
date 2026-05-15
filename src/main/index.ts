import { app, BrowserWindow, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registerIpc } from './ipc'
import { readConfig } from './config'
import { sweepEngineState } from './sync/engine/sweep'

const __dirname = dirname(fileURLToPath(import.meta.url))

function configureAppMenu(): void {
  // Hide the default Electron menu (File/Edit/View/Window/Help) on
  // Windows + Linux entirely. macOS requires an app menu (otherwise Cmd-Q
  // and friends stop working), so install a minimal one with only the
  // standard app/edit/window roles.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    // In dev, the Vite renderer may not be up yet when Electron starts.
    // Retry loading until it succeeds (max 30 attempts × 500ms = 15s).
    let attempts = 0
    const maxAttempts = 30
    const tryLoad = () => {
      win.loadURL(rendererUrl).catch(() => {
        if (attempts++ < maxAttempts && !win.isDestroyed()) {
          setTimeout(tryLoad, 500)
        }
      })
    }
    win.webContents.on('did-fail-load', (_e, errorCode) => {
      // -102 = ERR_CONNECTION_REFUSED — renderer not ready yet
      if (errorCode === -102 && attempts++ < maxAttempts && !win.isDestroyed()) {
        setTimeout(tryLoad, 500)
      }
    })
    tryLoad()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Hide menu bar on Win/Linux completely (Alt key won't reveal it either).
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false)
  }

  registerIpc(win)
  return win
}

app.whenReady().then(() => {
  configureAppMenu()
  // Best-effort cleanup of orphaned tmp-index files left by previous crashes
  // before any new Engine push/resolve can run.
  try {
    const cfg = readConfig(join(app.getPath('userData'), 'config.json'))
    if (cfg.repoPath) sweepEngineState(cfg.repoPath, app.getPath('userData'))
  } catch {
    /* sweep is best-effort; never block startup */
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
