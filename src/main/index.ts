import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registerIpc } from './ipc'

const __dirname = dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
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

  registerIpc(win)
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
