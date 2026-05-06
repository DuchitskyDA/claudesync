import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import type { LogLine, Platform, RunResult, AppConfig, SetConfigResult } from '@shared/api'
import { runCommand, withRunLock } from './runner'
import { readConfig, writeConfig, validateRepoPath } from './config'

export type RunUpdateDeps = {
  currentPlatform: NodeJS.Platform
  configPath: string
  emit: (line: LogLine) => void
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function platformMatches(target: Platform, current: NodeJS.Platform): boolean {
  return (target === 'macos' && current === 'darwin') || (target === 'windows' && current === 'win32')
}

export async function runUpdateHandler(target: Platform, deps: RunUpdateDeps): Promise<RunResult> {
  if (!platformMatches(target, deps.currentPlatform)) {
    return { ok: false, exitCode: -1, error: `Platform mismatch: button ${target}, OS ${deps.currentPlatform}` }
  }
  const cfg = readConfig(deps.configPath)
  if (!cfg.repoPath) {
    return { ok: false, exitCode: -1, error: 'Repo path not configured. Open Settings and choose a folder.' }
  }
  const v = validateRepoPath(cfg.repoPath)
  if (!v.ok) {
    return { ok: false, exitCode: -1, error: v.error }
  }
  const scriptName = target === 'macos' ? 'install.sh' : 'install.ps1'
  const scriptPath = join(cfg.repoPath, scriptName)
  if (!existsSync(scriptPath)) {
    return { ok: false, exitCode: -1, error: `${scriptName} not found at ${cfg.repoPath}` }
  }
  const repoPath = cfg.repoPath
  return withRunLock(async () => {
    deps.emit({ time: nowHHMMSS(), text: '$ git pull', level: 'info' })
    const pull = await runCommand('git', ['pull'], { cwd: repoPath, onLine: deps.emit })
    if (pull.exitCode !== 0) {
      deps.emit({ time: nowHHMMSS(), text: `✗ git pull failed (exit ${pull.exitCode})`, level: 'error' })
      return { ok: false, exitCode: pull.exitCode }
    }
    deps.emit({ time: nowHHMMSS(), text: `$ ${scriptName}`, level: 'info' })
    const inst =
      target === 'macos'
        ? await runCommand('bash', [scriptPath], { cwd: repoPath, onLine: deps.emit })
        : await runCommand(
            'powershell',
            ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
            { cwd: repoPath, onLine: deps.emit },
          )
    if (inst.exitCode !== 0) {
      deps.emit({ time: nowHHMMSS(), text: `✗ install failed (exit ${inst.exitCode})`, level: 'error' })
      return { ok: false, exitCode: inst.exitCode }
    }
    deps.emit({ time: nowHHMMSS(), text: '✓ DONE (exit 0)', level: 'success' })
    return { ok: true, exitCode: 0 }
  }).catch((e: Error) => ({ ok: false, exitCode: -1, error: e.message }))
}

export function registerIpc(window: BrowserWindow): void {
  const configPath = join(app.getPath('userData'), 'config.json')
  const emit = (line: LogLine) => {
    if (!window.isDestroyed()) window.webContents.send('log', line)
  }

  ipcMain.handle('run-update', (_e, platform: Platform) =>
    runUpdateHandler(platform, { currentPlatform: process.platform, configPath, emit }),
  )

  ipcMain.handle('get-config', (): AppConfig => readConfig(configPath))

  ipcMain.handle('set-config', (_e, cfg: AppConfig): SetConfigResult => {
    if (!cfg.repoPath) return { ok: false, error: 'Empty repo path' }
    const v = validateRepoPath(cfg.repoPath)
    if (!v.ok) return { ok: false, error: v.error }
    writeConfig(configPath, cfg)
    return { ok: true }
  })

  ipcMain.handle('pick-repo-path', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0] ?? null
  })

  ipcMain.handle('get-platform', (): NodeJS.Platform => process.platform)
}
