import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ipcMain, dialog, BrowserWindow, app, shell, screen } from 'electron'
import type {
  LogLine,
  RunResult,
  AppConfig,
  SetConfigResult,
  StepEvent,
  ApplyPluginChanges,
  InitStepEvent,
  PushStepEvent,
  PushOptions,
  InitWizardOptions,
  LocalizedMessage,
} from '@shared/api'
import { runCommand, withRunLock } from './runner'
import {
  readConfig,
  writeConfig,
  validateLocalRepo,
  validateRepoUrl,
  validateRulesTarget,
  expandTilde,
  detectClaudeTarget,
  suggestedClaudeTargetPath,
  defaultManagedRepoPath,
} from './config'
import { fetchCatalog } from './catalog'
import { getInstalled, applyChanges, settingsPathFor, validateClaudeTarget } from './plugins'
import {
  startDeviceFlow,
  pollDeviceFlow,
  cancelDeviceFlow,
  getAuthState,
  signOut,
} from './github-auth'
import { listOwners } from './github-api'
import { initRepo, scanLocalConfig, templatesDir } from './init-wizard'
import { runPush, getRepoStatus } from './push'
import { getSyncStatus } from './sync-status'
import { getUpdateInfo } from './update-checker'
import {
  setupAutoUpdater,
  checkForUpdates as checkAutoUpdates,
  startUpdateDownload,
  quitAndInstall,
} from './auto-updater'
import { isBrewAvailable, runBrewUpgrade } from './brew-updater'
import {
  getConflictState,
  getStageContent,
  resolveFile,
  continueRebase,
  abortRebase,
  STAGE_BASE,
  STAGE_REMOTE,
  STAGE_MINE,
} from './conflict'
import { loadToken } from './safe-storage'

const LOG_LIMIT = 200

export type RunSyncDeps = {
  currentPlatform: NodeJS.Platform
  configPath: string
  emit: (line: LogLine) => void
  emitStep: (e: StepEvent) => void
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fail(error: LocalizedMessage): RunResult {
  return { ok: false, exitCode: -1, error }
}

function failWithExit(prefix: string, exitCode: number, emit: (l: LogLine) => void): RunResult {
  emit({ time: nowHHMMSS(), text: `✗ ${prefix} (exit ${exitCode})`, level: 'error' })
  return { ok: false, exitCode }
}

export async function runSyncHandler(deps: RunSyncDeps): Promise<RunResult> {
  const cfg = readConfig(deps.configPath)
  if (!cfg.repoUrl) return fail({ key: 'config.error.urlRequired', fallback: 'Repo URL not configured. Open Settings.' })
  if (!cfg.repoPath) return fail({ key: 'config.error.localRepoRequired', fallback: 'Local repo path not configured. Open Settings.' })
  if (!cfg.rulesTarget) return fail({ key: 'config.error.targetRequired', fallback: 'Rules target folder not configured. Open Settings.' })

  const u = validateRepoUrl(cfg.repoUrl)
  if (!u.ok) return fail(u.error)
  const p = validateLocalRepo(cfg.repoPath)
  if (!p.ok) return fail(p.error)
  const t = validateRulesTarget(cfg.rulesTarget)
  if (!t.ok) return fail(t.error)

  const repoUrl = cfg.repoUrl
  const repoPath = cfg.repoPath
  const rulesTarget = cfg.rulesTarget
  const isWin = deps.currentPlatform === 'win32'

  return withRunLock(async () => {
    const isExistingRepo = existsSync(join(repoPath, '.git'))
    deps.emitStep({ step: 'fetch', status: 'running' })
    if (!isExistingRepo) {
      deps.emit({ time: nowHHMMSS(), text: `$ git clone ${repoUrl} ${repoPath}`, level: 'info' })
      mkdirSync(dirname(repoPath), { recursive: true })
      const clone = await runCommand('git', ['clone', repoUrl, repoPath], {
        cwd: dirname(repoPath),
        onLine: deps.emit,
      })
      if (clone.exitCode !== 0) {
        deps.emitStep({ step: 'fetch', status: 'failed', message: { key: 'sync.error.cloneFailed', params: { exitCode: clone.exitCode }, fallback: `git clone failed (exit ${clone.exitCode})` } })
        return failWithExit('git clone failed', clone.exitCode, deps.emit)
      }
    } else {
      deps.emit({ time: nowHHMMSS(), text: '$ git pull', level: 'info' })
      const pull = await runCommand('git', ['pull'], { cwd: repoPath, onLine: deps.emit })
      if (pull.exitCode !== 0) {
        deps.emitStep({ step: 'fetch', status: 'failed', message: { key: 'sync.error.pullFailed', params: { exitCode: pull.exitCode }, fallback: `git pull failed (exit ${pull.exitCode})` } })
        return failWithExit('git pull failed', pull.exitCode, deps.emit)
      }
    }
    deps.emitStep({ step: 'fetch', status: 'done' })

    const scriptName = isWin ? 'install.ps1' : 'install.sh'
    const scriptPath = join(repoPath, scriptName)
    if (!existsSync(scriptPath)) {
      return fail({ key: 'sync.error.scriptNotFound', params: { scriptName }, fallback: `${scriptName} not found in repo root` })
    }

    deps.emit({
      time: nowHHMMSS(),
      text: `$ ${scriptName} (RULES_TARGET=${rulesTarget})`,
      level: 'info',
    })

    deps.emitStep({ step: 'install', status: 'running' })
    const env = { RULES_TARGET: rulesTarget }
    const inst = isWin
      ? await runCommand(
          'powershell',
          ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          { cwd: repoPath, env, onLine: deps.emit },
        )
      : await runCommand('bash', [scriptPath], { cwd: repoPath, env, onLine: deps.emit })

    if (inst.exitCode !== 0) {
      deps.emitStep({ step: 'install', status: 'failed', message: { key: 'sync.error.installFailed', params: { exitCode: inst.exitCode }, fallback: `install failed (exit ${inst.exitCode})` } })
      return failWithExit('install failed', inst.exitCode, deps.emit)
    }
    deps.emitStep({ step: 'install', status: 'done' })
    deps.emit({ time: nowHHMMSS(), text: '✓ DONE (exit 0)', level: 'success' })
    return { ok: true, exitCode: 0 }
  }).catch((e: Error) => ({ ok: false, exitCode: -1, error: { key: 'sync.error.unexpected', fallback: e.message } as LocalizedMessage }))
}

export function registerIpc(window: BrowserWindow): void {
  // Configure auto-updater on first registration. macOS is a no-op inside.
  setupAutoUpdater(window)

  const configPath = join(app.getPath('userData'), 'config.json')
  const logFile = join(app.getPath('userData'), 'last-run.log')
  const logBuffer: LogLine[] = []
  const emit = (line: LogLine) => {
    if (!window.isDestroyed()) window.webContents.send('log', line)
    logBuffer.push(line)
    if (logBuffer.length > LOG_LIMIT) logBuffer.shift()
    try {
      writeFileSync(
        logFile,
        logBuffer.map((l) => `[${l.time}] ${l.level.toUpperCase()} ${l.text}`).join('\n') + '\n',
      )
    } catch {
      // ignore disk errors
    }
  }
  const emitStep = (e: StepEvent) => {
    if (!window.isDestroyed()) window.webContents.send('step', e)
  }

  ipcMain.handle('run-sync', () =>
    runSyncHandler({ currentPlatform: process.platform, configPath, emit, emitStep }),
  )

  ipcMain.handle('get-config', (): AppConfig => readConfig(configPath))

  ipcMain.handle('set-config', (_e, cfg: AppConfig): SetConfigResult => {
    const normalized: AppConfig = {
      repoUrl: cfg.repoUrl,
      repoPath: cfg.repoPath ? expandTilde(cfg.repoPath) : null,
      rulesTarget: cfg.rulesTarget ? expandTilde(cfg.rulesTarget) : null,
      includeSecretsInPush: cfg.includeSecretsInPush ?? false,
      locale: cfg.locale ?? null,
      lastDismissedUpdate: cfg.lastDismissedUpdate ?? null,
    }
    if (normalized.repoUrl) {
      const u = validateRepoUrl(normalized.repoUrl)
      if (!u.ok) return { ok: false, error: u.error }
    }
    if (normalized.repoPath) {
      const p = validateLocalRepo(normalized.repoPath)
      if (!p.ok) return { ok: false, error: p.error }
    }
    if (normalized.rulesTarget) {
      const t = validateRulesTarget(normalized.rulesTarget)
      if (!t.ok) return { ok: false, error: t.error }
    }
    writeConfig(configPath, normalized)
    return { ok: true }
  })

  ipcMain.handle('pick-repo-path', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0] ?? null
  })

  ipcMain.handle('get-platform', (): NodeJS.Platform => process.platform)
  ipcMain.handle('get-arch', (): NodeJS.Architecture => process.arch)
  ipcMain.handle('resize-window-by', (_e, delta: number) => {
    if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return
    const display = screen.getDisplayMatching(window.getBounds())
    const work = display.workArea
    const size = window.getSize()
    const w = size[0] ?? 720
    const h = size[1] ?? 520
    const newH = Math.max(360, Math.min(work.height, h + delta))
    if (newH === h) return
    window.setSize(w, newH, true)
    // If we'd otherwise extend below the screen, nudge the window up.
    const pos = window.getPosition()
    const x = pos[0] ?? 0
    const y = pos[1] ?? 0
    const bottom = y + newH
    const screenBottom = work.y + work.height
    if (bottom > screenBottom) {
      const newY = Math.max(work.y, y - (bottom - screenBottom))
      window.setPosition(x, newY, true)
    }
  })
  ipcMain.handle('get-system-locale', () => app.getLocale())

  ipcMain.handle('open-external', (_e, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle('get-plugin-catalog', (_e, force?: boolean) => fetchCatalog({ force }))

  ipcMain.handle('get-installed-plugins', () => {
    const cfg = readConfig(configPath)
    if (!cfg.rulesTarget) return { enabledIds: [], envSet: [], knownMarketplaces: [] }
    return getInstalled(settingsPathFor(cfg.rulesTarget))
  })

  ipcMain.handle('apply-plugin-changes', (_e, changes: ApplyPluginChanges) => {
    const cfg = readConfig(configPath)
    if (!cfg.rulesTarget) return { ok: false, error: { key: 'config.error.targetRequired' } as LocalizedMessage }
    const settingsPath = settingsPathFor(cfg.rulesTarget)
    try {
      return applyChanges(settingsPath, changes)
    } catch (e) {
      return { ok: false, error: { key: 'plugins.error.applyFailed', params: { reason: (e as Error).message }, fallback: (e as Error).message } as LocalizedMessage }
    }
  })

  ipcMain.handle('validate-claude-target', () => {
    const cfg = readConfig(configPath)
    return validateClaudeTarget(cfg.rulesTarget)
  })

  ipcMain.handle('detect-rules-target', () => detectClaudeTarget())
  ipcMain.handle('suggest-rules-target', () => suggestedClaudeTargetPath())
  ipcMain.handle('suggest-repo-path', (_e, url: string) =>
    defaultManagedRepoPath(url, app.getPath('userData')),
  )

  const userDataDir = app.getPath('userData')

  // Auth
  ipcMain.handle('get-auth-state', () => getAuthState(userDataDir))
  ipcMain.handle('start-device-flow', () => startDeviceFlow())
  ipcMain.handle('poll-device-flow', () => pollDeviceFlow(userDataDir))
  ipcMain.handle('cancel-device-flow', () => cancelDeviceFlow())
  ipcMain.handle('sign-out', () => {
    signOut(userDataDir)
  })

  // GitHub
  ipcMain.handle('list-owners', () => {
    const token = loadToken(userDataDir)
    if (!token) throw new Error('Not authenticated')
    return listOwners(token)
  })

  // Init wizard
  ipcMain.handle('scan-local-config', () => {
    const cfg = readConfig(configPath)
    if (!cfg.rulesTarget) return { files: [], excluded: [], totalSize: 0 }
    return scanLocalConfig(cfg.rulesTarget)
  })

  const emitInitStep = (e: InitStepEvent) => {
    if (!window.isDestroyed()) window.webContents.send('init-step', e)
  }

  ipcMain.handle('init-repo', async (_e, opts: InitWizardOptions) => {
    const cfg = readConfig(configPath)
    if (!cfg.rulesTarget) return { ok: false, exitCode: -1, error: { key: 'config.error.targetRequired', fallback: 'Rules target not set' } }
    const result = await initRepo({
      ownerLogin: opts.owner,
      name: opts.name,
      isPrivate: opts.isPrivate,
      description: opts.description,
      rulesTarget: cfg.rulesTarget,
      userDataDir,
      tplDir: templatesDir(),
      emit,
      emitStep: emitInitStep,
    })
    if (result.ok && 'repoUrl' in result && 'repoPath' in result && result.repoUrl && result.repoPath) {
      const fresh = readConfig(configPath)
      writeConfig(configPath, { ...fresh, repoUrl: result.repoUrl, repoPath: result.repoPath })
    }
    return result
  })

  // Push
  const emitPushStep = (e: PushStepEvent) => {
    if (!window.isDestroyed()) window.webContents.send('push-step', e)
  }

  ipcMain.handle('get-repo-status', () => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return { changedFiles: [], clean: true }
    return getRepoStatus(cfg.repoPath)
  })

  // Sync status — cached; refresh re-runs `git fetch`.
  let cachedSyncStatus: import('@shared/api').SyncStatus = {
    state: 'unknown',
    behind: 0,
    ahead: 0,
    localChanges: 0,
    fetchedAt: null,
  }
  ipcMain.handle('get-sync-status', async () => {
    const cfg = readConfig(configPath)
    if (cachedSyncStatus.fetchedAt !== null) {
      // Cache hit — recount with current local commits but skip network.
      const fresh = await getSyncStatus({
        repoPath: cfg.repoPath,
        userDataDir,
        doFetch: false,
      })
      // Preserve fetchedAt so UI shows "last checked" relative time.
      cachedSyncStatus = { ...fresh, fetchedAt: cachedSyncStatus.fetchedAt }
      return cachedSyncStatus
    }
    cachedSyncStatus = await getSyncStatus({
      repoPath: cfg.repoPath,
      userDataDir,
      doFetch: false,
    })
    return cachedSyncStatus
  })
  ipcMain.handle('refresh-sync-status', async () => {
    const cfg = readConfig(configPath)
    cachedSyncStatus = await getSyncStatus({
      repoPath: cfg.repoPath,
      userDataDir,
      doFetch: true,
    })
    return cachedSyncStatus
  })

  // Update checker — call GitHub Releases API and compare against running app version.
  ipcMain.handle('get-update-info', () => {
    return getUpdateInfo({ current: app.getVersion(), doFetch: false })
  })
  ipcMain.handle('check-for-updates', () => {
    return getUpdateInfo({ current: app.getVersion(), doFetch: true })
  })
  ipcMain.handle('dismiss-update', (_e, version: string) => {
    const cfg = readConfig(configPath)
    writeConfig(configPath, { ...cfg, lastDismissedUpdate: version })
  })
  // 1-click in-app update: per platform.
  // - darwin: silent brew upgrade if brew is on PATH; otherwise the renderer
  //   falls back to opening the GitHub release URL directly.
  // - win32 / linux: electron-updater downloads in background, then quits
  //   and runs the new installer. SmartScreen does NOT trigger because
  //   the file is downloaded by Node (no Mark-of-the-Web tag).
  ipcMain.handle('updater-supported', () => {
    if (process.platform === 'darwin') return isBrewAvailable() ? 'brew' : 'none'
    if (process.platform === 'win32' || process.platform === 'linux') return 'auto'
    return 'none'
  })
  ipcMain.handle('updater-start', async () => {
    if (process.platform === 'darwin') {
      await runBrewUpgrade(window)
      return
    }
    await checkAutoUpdates()
    await startUpdateDownload()
  })
  ipcMain.handle('updater-quit-and-install', () => {
    quitAndInstall()
  })

  ipcMain.handle('run-push', (_e, opts: PushOptions) => {
    return runPush({
      configPath,
      userDataDir,
      includeSecrets: opts.includeSecrets,
      commitMessage: opts.commitMessage,
      emit,
      emitStep: emitPushStep,
    })
  })

  // Conflict resolution
  ipcMain.handle('conflict-get-state', () => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return { inProgress: false, files: [] }
    return getConflictState(cfg.repoPath)
  })

  ipcMain.handle('conflict-get-file', (_e, path: string, side: 'base' | 'remote' | 'mine') => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return { text: null, binary: false }
    const stage =
      side === 'base' ? STAGE_BASE : side === 'remote' ? STAGE_REMOTE : STAGE_MINE
    return getStageContent(cfg.repoPath, path, stage)
  })

  ipcMain.handle(
    'conflict-resolve-file',
    (_e, path: string, choice: 'mine' | 'remote' | 'manual') => {
      const cfg = readConfig(configPath)
      if (!cfg.repoPath) {
        return { ok: false, error: { key: 'push.error.notConfigured' } }
      }
      return resolveFile(cfg.repoPath, path, choice)
    },
  )

  ipcMain.handle('conflict-open-in-editor', async (_e, path: string) => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return
    await shell.openPath(join(cfg.repoPath, path))
  })

  ipcMain.handle('conflict-continue', () => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) {
      return { ok: false, exitCode: -1, error: { key: 'push.error.notConfigured' } }
    }
    return continueRebase(cfg.repoPath)
  })

  ipcMain.handle('conflict-abort', () => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return
    abortRebase(cfg.repoPath)
  })
}
