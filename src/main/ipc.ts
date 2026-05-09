import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  InstallOptions,
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
  validateClaudePath,
  validateCatalogUrl,
  validateCursorProject,
  expandTilde,
  detectClaudeTarget,
  suggestedClaudeTargetPath,
  defaultManagedRepoPath,
} from './config'
import { validateCursorProjects } from './sync/cursor-validation'
import { fetchCatalog } from './catalog'
import { getInstalled, applyChanges, settingsPathFor, validateClaudeTarget } from './plugins'
import {
  startDeviceFlow,
  pollDeviceFlow,
  cancelDeviceFlow,
  getAuthState,
  signOut,
} from './github-auth'
import { listOwners, repoExists } from './github-api'
import { initRepo, scanLocalConfig, templatesDir } from './init-wizard'
import { runPush, getRepoStatus } from './push'
import { detectClaudeInstallMode, exportClaude, installClaude, stripSecretsInClaudeRepo } from './sync/claude'
import { exportCursorProjects } from './sync/cursor'
import { installCursorProjects } from './sync/cursor-install'
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
  if (!cfg.claude.enabled || !cfg.claude.path) return fail({ key: 'config.error.targetRequired', fallback: 'Claude config folder not configured. Open Settings.' })

  const u = validateRepoUrl(cfg.repoUrl)
  if (!u.ok) return fail(u.error)
  const p = validateLocalRepo(cfg.repoPath)
  if (!p.ok) return fail(p.error)
  const t = validateClaudePath(cfg.claude.path)
  if (!t.ok) return fail(t.error)

  const repoUrl = cfg.repoUrl
  const repoPath = cfg.repoPath
  const rulesTarget = cfg.claude.path
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
    const claudePath = cfg.claude?.path ? expandTilde(cfg.claude.path) : null
    const normalizedCatalogUrl =
      typeof cfg.catalogUrl === 'string' && cfg.catalogUrl.trim() !== ''
        ? cfg.catalogUrl.trim()
        : null
    const normalized: AppConfig = {
      repoUrl: cfg.repoUrl,
      repoPath: cfg.repoPath ? expandTilde(cfg.repoPath) : null,
      includeSecretsInPush: cfg.includeSecretsInPush ?? false,
      locale: cfg.locale ?? null,
      lastDismissedUpdate: cfg.lastDismissedUpdate ?? null,
      claude: {
        enabled: cfg.claude?.enabled ?? false,
        path: claudePath,
      },
      cursor: {
        enabled: cfg.cursor?.enabled ?? false,
        projects: (cfg.cursor?.projects ?? []).map((p) => ({
          name: p.name,
          path: expandTilde(p.path),
        })),
      },
      catalogUrl: normalizedCatalogUrl,
    }
    if (normalized.repoUrl) {
      const u = validateRepoUrl(normalized.repoUrl)
      if (!u.ok) return { ok: false, error: u.error }
    }
    if (normalized.repoPath) {
      const p = validateLocalRepo(normalized.repoPath)
      if (!p.ok) return { ok: false, error: p.error }
    }
    if (normalized.claude.path) {
      const t = validateClaudePath(normalized.claude.path)
      if (!t.ok) return { ok: false, error: t.error }
    }
    if (normalized.cursor.projects.length > 0) {
      const cv = validateCursorProjects(normalized.cursor.projects)
      if (!cv.ok) return { ok: false, error: cv.error }
    }
    {
      const cu = validateCatalogUrl(normalized.catalogUrl)
      if (!cu.ok) return { ok: false, error: cu.error }
    }

    // Clean up working-tree directories of Cursor projects that were removed
    // in this save. If files were tracked, git status will show them as
    // deleted; the next push commits the deletion. If untracked (just-added
    // then-removed case), they're simply gone — no orphaned diff left over.
    const previous = readConfig(configPath)
    if (normalized.repoPath) {
      const newNames = new Set(normalized.cursor.projects.map((p) => p.name))
      for (const oldP of previous.cursor.projects) {
        if (!newNames.has(oldP.name)) {
          const dir = join(normalized.repoPath, 'cursor', 'projects', oldP.name)
          if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
        }
      }
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

  ipcMain.handle('get-plugin-catalog', (_e, force?: boolean) => {
    const cfg = readConfig(configPath)
    return fetchCatalog({ force, catalogUrl: cfg.catalogUrl })
  })

  ipcMain.handle('get-installed-plugins', () => {
    const cfg = readConfig(configPath)
    if (!cfg.claude.path) return { enabledIds: [], envSet: [], knownMarketplaces: [] }
    return getInstalled(settingsPathFor(cfg.claude.path))
  })

  ipcMain.handle('apply-plugin-changes', (_e, changes: ApplyPluginChanges) => {
    const cfg = readConfig(configPath)
    if (!cfg.claude.path) return { ok: false, error: { key: 'config.error.targetRequired' } as LocalizedMessage }
    const settingsPath = settingsPathFor(cfg.claude.path)
    try {
      return applyChanges(settingsPath, changes)
    } catch (e) {
      return { ok: false, error: { key: 'plugins.error.applyFailed', params: { reason: (e as Error).message }, fallback: (e as Error).message } as LocalizedMessage }
    }
  })

  ipcMain.handle('validate-claude-target', () => {
    const cfg = readConfig(configPath)
    return validateClaudeTarget(cfg.claude.path)
  })

  // New canonical channel names for Phase A
  ipcMain.handle('detect-claude-path', () => detectClaudeTarget())
  ipcMain.handle('suggest-claude-path', () => suggestedClaudeTargetPath())
  ipcMain.handle('pick-cursor-project-path', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select Cursor project root',
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0] ?? null
  })
  ipcMain.handle('validate-cursor-project', (_e, p: { name: string; path: string }) => {
    return validateCursorProject(p)
  })
  ipcMain.handle('bootstrap-cursor-project', (_e, projectPath: string): { created: string[] } => {
    const created: string[] = []
    const expanded = expandTilde(projectPath)
    const dotCursor = join(expanded, '.cursor')
    for (const sub of ['rules', 'skills']) {
      const dir = join(dotCursor, sub)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, '.gitkeep'), '')
        created.push(`.cursor/${sub}/`)
      }
    }
    return { created }
  })

  // Legacy channel names — kept for backwards compat, drop after renderer is migrated.
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
  ipcMain.handle('check-repo-exists', async (_e, owner: string, name: string) => {
    const token = loadToken(userDataDir)
    if (!token) throw new Error('Not authenticated')
    return repoExists(token, owner, name)
  })

  // Init wizard
  ipcMain.handle('scan-local-config', () => {
    const cfg = readConfig(configPath)
    if (!cfg.claude.path) return { files: [], excluded: [], totalSize: 0 }
    return scanLocalConfig(cfg.claude.path)
  })
  // Canonical alias
  ipcMain.handle('scan-claude-config', () => {
    const cfg = readConfig(configPath)
    if (!cfg.claude.path) return { files: [], excluded: [], totalSize: 0 }
    return scanLocalConfig(cfg.claude.path)
  })

  const emitInitStep = (e: InitStepEvent) => {
    if (!window.isDestroyed()) window.webContents.send('init-step', e)
  }

  ipcMain.handle('init-repo', async (_e, opts: InitWizardOptions) => {
    // Init creates a clean template-only repo — Claude/Cursor data is synced
    // separately via the Push flow once targets are configured. So we don't
    // require cfg.claude.path here anymore.
    const result = await initRepo({
      ownerLogin: opts.owner,
      name: opts.name,
      isPrivate: opts.isPrivate,
      description: opts.description,
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

  /** Runs all enabled exporters into the working tree. Idempotent — safe to
   *  call from any read-only-feeling operation (chip refresh, push preview).
   *  Errors are swallowed; the real push surfaces them. */
  function runEnabledExporters(cfg: AppConfig, silent = true): void {
    if (!cfg.repoPath) return
    if (cfg.claude.enabled && cfg.claude.path) {
      try {
        if (detectClaudeInstallMode(cfg.claude.path) === 'copy') {
          exportClaude(cfg.claude.path, cfg.repoPath)
        }
        if (!cfg.includeSecretsInPush) stripSecretsInClaudeRepo(cfg.repoPath)
      } catch {
        /* surfaced on real push */
      }
    }
    if (cfg.cursor.enabled && cfg.cursor.projects.length > 0) {
      try {
        exportCursorProjects(cfg.cursor.projects, cfg.repoPath, silent ? undefined : emit)
      } catch {
        /* surfaced on real push */
      }
    }
  }

  ipcMain.handle('get-repo-status', () => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return { changedFiles: [], clean: true }
    runEnabledExporters(cfg)
    return getRepoStatus(cfg.repoPath)
  })

  ipcMain.handle('preview-push-status', async () => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return { changedFiles: [], clean: true }
    runEnabledExporters(cfg, false)
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
    runEnabledExporters(cfg)
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
    runEnabledExporters(cfg)
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

  ipcMain.handle('open-repo-file', async (_e, relPath: string) => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath || !relPath) return
    // Strip trailing slash that `git status --porcelain` adds for untracked dirs.
    const cleaned = relPath.replace(/[/\\]+$/, '')
    await shell.openPath(join(cfg.repoPath, cleaned))
  })

  ipcMain.handle('list-repo-cursor-subdirs', (): string[] => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return []
    const dir = join(cfg.repoPath, 'cursor', 'projects')
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== '.gitkeep')
        .map((e) => e.name)
        .sort()
    } catch {
      return []
    }
  })

  ipcMain.handle('check-install-needed', (): boolean => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return false
    // Claude target: any visible content in <repo>/claude/ besides .gitkeep
    if (cfg.claude.enabled && cfg.claude.path) {
      const claudeRepo = join(cfg.repoPath, 'claude')
      if (existsSync(claudeRepo)) {
        try {
          const entries = readdirSync(claudeRepo).filter((n) => n !== '.gitkeep')
          if (entries.length > 0) return true
        } catch {
          /* ignore */
        }
      }
    }
    // Cursor: any registered project that has content in repo
    if (cfg.cursor.enabled) {
      for (const p of cfg.cursor.projects) {
        const projDir = join(cfg.repoPath, 'cursor', 'projects', p.name)
        if (!existsSync(projDir)) continue
        try {
          const entries = readdirSync(projDir).filter((n) => n !== '.gitkeep')
          if (entries.length > 0) return true
        } catch {
          /* ignore */
        }
      }
    }
    return false
  })

  ipcMain.handle('run-pull', async (): Promise<RunResult> => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) {
      return { ok: false, exitCode: -1, error: { key: 'config.error.localRepoRequired' } }
    }
    const token = loadToken(userDataDir)
    if (!token) {
      return { ok: false, exitCode: -1, error: { key: 'push.error.notSignedIn' } }
    }
    const repoPath = cfg.repoPath
    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
    const authHeader = ['-c', `http.extraheader=Authorization: Basic ${basic}`]
    emit({ time: nowHHMMSS(), text: '$ git pull --rebase --autostash', level: 'info' })
    const r = await runCommand(
      'git',
      [...authHeader, '-C', repoPath, 'pull', '--rebase', '--autostash'],
      { cwd: repoPath, onLine: emit },
    )
    if (r.exitCode !== 0) {
      return {
        ok: false,
        exitCode: r.exitCode,
        error: { key: 'pull.error.failed', fallback: r.stderr.trim().split(/\r?\n/).slice(-2).join(' | ') },
      }
    }
    emit({ time: nowHHMMSS(), text: '✓ Pull done', level: 'success' })
    return { ok: true, exitCode: 0 }
  })

  ipcMain.handle('discard-local-changes', async (): Promise<RunResult> => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) {
      return { ok: false, exitCode: -1, error: { key: 'config.error.localRepoRequired' } }
    }
    const repoPath = cfg.repoPath
    emit({ time: nowHHMMSS(), text: '$ git checkout -- .', level: 'info' })
    const checkout = await runCommand('git', ['-C', repoPath, 'checkout', '--', '.'], {
      cwd: repoPath,
      onLine: emit,
    })
    if (checkout.exitCode !== 0) {
      return { ok: false, exitCode: checkout.exitCode, error: { key: 'discard.error.failed', fallback: 'git checkout failed' } }
    }
    emit({ time: nowHHMMSS(), text: '$ git clean -fd', level: 'info' })
    const clean = await runCommand('git', ['-C', repoPath, 'clean', '-fd'], {
      cwd: repoPath,
      onLine: emit,
    })
    if (clean.exitCode !== 0) {
      return { ok: false, exitCode: clean.exitCode, error: { key: 'discard.error.failed', fallback: 'git clean failed' } }
    }
    // Reverse-mirror repo HEAD back into source dirs so the very next
    // get-repo-status / refresh-sync-status — which always re-runs
    // `runEnabledExporters` — produces no diff. Without this step a still-
    // modified Cursor project source would be re-exported into the repo
    // immediately after `git checkout`, making Discard appear to do
    // nothing. Discard semantics: "throw away ALL local edits, align
    // source dirs with repo HEAD".
    if (cfg.cursor.enabled && cfg.cursor.projects.length > 0) {
      try {
        installCursorProjects(repoPath, cfg.cursor.projects, emit)
      } catch (e) {
        emit({
          time: nowHHMMSS(),
          text: `cursor reverse-mirror failed: ${(e as Error).message}`,
          level: 'error',
        })
      }
    }
    // Claude in `copy` install mode has the same loop: a still-modified
    // ~/.claude tree gets re-exported into the repo by the next
    // `runEnabledExporters` pass and Discard appears to do nothing.
    // `installClaude` is a no-op when the user is in symlink mode (git
    // checkout already updated the underlying inodes via the symlinks).
    if (cfg.claude.enabled && cfg.claude.path) {
      try {
        installClaude(repoPath, cfg.claude.path)
      } catch (e) {
        emit({
          time: nowHHMMSS(),
          text: `claude reverse-mirror failed: ${(e as Error).message}`,
          level: 'error',
        })
      }
    }
    emit({ time: nowHHMMSS(), text: '✓ Local changes discarded', level: 'success' })
    return { ok: true, exitCode: 0 }
  })

  ipcMain.handle('run-install', async (_e, opts: InstallOptions): Promise<RunResult> => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) {
      return { ok: false, exitCode: -1, error: { key: 'config.error.localRepoRequired' } }
    }
    const repoPath = cfg.repoPath
    const isWin = process.platform === 'win32'

    // Claude: run repo's install.ps1 / install.sh against cfg.claude.path.
    if (opts.installClaude) {
      if (!cfg.claude.path) {
        return { ok: false, exitCode: -1, error: { key: 'config.error.targetRequired' } }
      }
      const scriptName = isWin ? 'install.ps1' : 'install.sh'
      const scriptPath = join(repoPath, scriptName)
      if (!existsSync(scriptPath)) {
        return {
          ok: false,
          exitCode: -1,
          error: {
            key: 'sync.error.scriptNotFound',
            params: { scriptName },
            fallback: `${scriptName} not found in repo root`,
          },
        }
      }
      emit({ time: nowHHMMSS(), text: `$ ${scriptName} (RULES_TARGET=${cfg.claude.path})`, level: 'info' })
      const env = { RULES_TARGET: cfg.claude.path }
      const inst = isWin
        ? await runCommand(
            'powershell',
            ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
            { cwd: repoPath, env, onLine: emit },
          )
        : await runCommand('bash', [scriptPath], { cwd: repoPath, env, onLine: emit })
      if (inst.exitCode !== 0) {
        return {
          ok: false,
          exitCode: inst.exitCode,
          error: {
            key: 'sync.error.installFailed',
            params: { exitCode: inst.exitCode },
            fallback: `install failed (exit ${inst.exitCode})`,
          },
        }
      }
    }

    // Cursor: copy repo content back into each registered project.
    if (opts.cursorProjectNames.length > 0) {
      const selected = cfg.cursor.projects.filter((p) =>
        opts.cursorProjectNames.includes(p.name),
      )
      try {
        installCursorProjects(repoPath, selected, emit)
      } catch (e) {
        return {
          ok: false,
          exitCode: -1,
          error: { key: 'install.error.cursorFailed', fallback: (e as Error).message },
        }
      }
    }

    emit({ time: nowHHMMSS(), text: '✓ Install done', level: 'success' })
    return { ok: true, exitCode: 0 }
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
