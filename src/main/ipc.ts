import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, dialog, BrowserWindow, app, shell, screen } from 'electron'
import type {
  LogLine,
  RunResult,
  AppConfig,
  SetConfigResult,
  ApplyPluginChanges,
  InitStepEvent,
  InstallOptions,
  PushStepEvent,
  PushOptions,
  InitWizardOptions,
  LocalizedMessage,
  McpInstallRequest,
  McpResult,
} from '@shared/api'
import { MCP_SERVERS, pkgName } from '@shared/mcp-registry'
import { runCommand } from './runner'
import {
  listMcpProjects,
  getMcpServer,
  setMcpServer,
  removeMcpServer,
} from './mcp/claude-json'
import { ensureUv, resolveUvx, prewarm, cleanCache } from './mcp/runtime'
import { withExclusiveLock, isLocked } from './sync/engine/op-lock'
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
import { findClaudeBin, runPluginInstalls } from './plugin-installer'
import { generateManifest, writeManifest, readManifest, manifestMissing } from './plugins-manifest'
import {
  startDeviceFlow,
  pollDeviceFlow,
  cancelDeviceFlow,
  getAuthState,
  signOut,
} from './github-auth'
import { listOwners, repoExists } from './github-api'
import { initRepo, scanLocalConfig, templatesDir } from './init-wizard'
import { installCursorProjects } from './sync/cursor-install'
import { refreshStatus, executePush, computePushPreview, computePullPreview, executePullApply, executeDiscard } from './sync/engine/engine'
import { detectClaudeProjects } from './sync/engine/claude-projects-detect'
import { gitDiagArgs, isGitDiagCmd } from './git-diag'
import { cloneRepo, findExistingClones, parseRepoUrl } from './git-clone'
import { isInstallNeeded } from './install-check'
import { getSyncStatus } from './sync-status'
import { getUpdateInfo } from './update-checker'
import {
  setupAutoUpdater,
  checkForUpdates as checkAutoUpdates,
  startUpdateDownload,
  quitAndInstall,
} from './auto-updater'
import { isBrewAvailable, runBrewUpgrade } from './brew-updater'
import { getResolverStateIPC, executeResolveIPC, discardResolverIPC } from './conflict'
import type { ResolverState } from '@shared/sync-types'
import { loadToken } from './safe-storage'

const LOG_LIMIT = 200

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function registerIpc(window: BrowserWindow): void {
  // Configure auto-updater on first registration. macOS is a no-op inside.
  setupAutoUpdater(window)

  const userDataDir = app.getPath('userData')
  const configPath = join(userDataDir, 'config.json')
  const logFile = join(userDataDir, 'last-run.log')
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
        projects: cfg.claude?.projects ?? [],
        syncGlobal: cfg.claude?.syncGlobal ?? { claudeMd: true, commands: true, skills: true, settings: true },
      },
      cursor: {
        enabled: cfg.cursor?.enabled ?? false,
        projects: (cfg.cursor?.projects ?? []).map((p) => ({
          name: p.name,
          path: expandTilde(p.path),
        })),
      },
      catalogUrl: normalizedCatalogUrl,
      manifestActivation: cfg.manifestActivation ?? {},
      knownEntryIds: cfg.knownEntryIds ?? [],
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

    writeConfig(configPath, normalized)
    // Keep the synced plugin manifest fresh when the feature is on (e.g. the
    // user just enabled it) so the next push carries the current plugin set.
    if (normalized.claude.path && normalized.claude.syncGlobal?.plugins === true) {
      try { writeManifest(normalized.claude.path, generateManifest(normalized.claude.path)) } catch { /* best effort */ }
    }
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

  ipcMain.handle('apply-plugin-changes', async (_e, changes: ApplyPluginChanges) => {
    const cfg = readConfig(configPath)
    if (!cfg.claude.path) return { ok: false, error: { key: 'config.error.targetRequired' } as LocalizedMessage }
    const settingsPath = settingsPathFor(cfg.claude.path)
    try {
      // Real install/uninstall via the official `claude plugin` CLI — this is
      // what actually populates plugins/installed_plugins.json (which getInstalled
      // reads). settings.json (env + enabledPlugins mirror) is written after.
      if (changes.enable.length > 0 || changes.disable.length > 0) {
        const bin = findClaudeBin()
        if (!bin) {
          return { ok: false, error: { key: 'plugins.error.cliNotFound', fallback: 'Claude CLI not found — install the `claude` CLI to manage plugins.' } as LocalizedMessage }
        }
        const res = await runPluginInstalls(bin, changes.enable, changes.disable)
        if (!res.ok) {
          return { ok: false, error: { key: 'plugins.error.installFailed', params: { reason: res.errors.join('; ') }, fallback: res.errors.join('; ') } as LocalizedMessage }
        }
      }
      const res = applyChanges(settingsPath, changes, userDataDir)
      // The install set changed — refresh the synced manifest if the feature is on.
      if (res.ok && cfg.claude.path && cfg.claude.syncGlobal?.plugins === true) {
        try { writeManifest(cfg.claude.path, generateManifest(cfg.claude.path)) } catch { /* best effort */ }
      }
      return res
    } catch (e) {
      return { ok: false, error: { key: 'plugins.error.applyFailed', params: { reason: (e as Error).message }, fallback: (e as Error).message } as LocalizedMessage }
    }
  })

  ipcMain.handle('get-plugin-manifest', () => {
    const cfg = readConfig(configPath)
    if (!cfg.claude.path) return { manifest: null, missingIds: [] }
    const manifest = readManifest(cfg.claude.path)
    const installedIds = getInstalled(settingsPathFor(cfg.claude.path)).installedIds
    return { manifest, missingIds: manifestMissing(manifest, installedIds) }
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

  ipcMain.handle('clone-repo', async (_e, url: unknown, targetPath: unknown) => {
    if (typeof url !== 'string' || typeof targetPath !== 'string') {
      return { ok: false, error: { key: 'clone.error.failed' } }
    }
    const expanded = expandTilde(targetPath)
    const v = validateLocalRepo(expanded)
    if (!v.ok) return { ok: false, error: v.error }
    const token = loadToken(userDataDir)
    // Pre-flight for GitHub URLs: give a clear "not found / no access" error
    // before attempting the clone. Network/rate-limit failures are swallowed —
    // let the clone itself try and surface a real git error.
    const ref = parseRepoUrl(url)
    if (ref && token) {
      try {
        if (!(await repoExists(token, ref.owner, ref.name))) {
          return {
            ok: false,
            error: { key: 'clone.error.notFound', params: { repo: `${ref.owner}/${ref.name}` }, fallback: `${ref.owner}/${ref.name} not found or no access` },
          }
        }
      } catch { /* network/rate-limit — proceed to clone anyway */ }
    }
    const res = await cloneRepo({ url, targetPath: expanded, token, onLine: emit })
    if (res.ok) writeConfig(configPath, { ...readConfig(configPath), repoPath: expanded })
    return res
  })

  ipcMain.handle('find-existing-clones', async (_e, url: unknown) => {
    if (typeof url !== 'string') return []
    return findExistingClones(url, [
      app.getPath('documents'),
      app.getPath('home'),
      join(userDataDir, 'repos'),
    ])
  })

  ipcMain.handle('adopt-repo-path', (_e, p: unknown) => {
    if (typeof p !== 'string') return { ok: false, error: { key: 'clone.error.failed' } }
    const expanded = expandTilde(p)
    if (!existsSync(join(expanded, '.git'))) {
      return { ok: false, error: { key: 'clone.error.notGitRepo', fallback: 'Not a git repo' } }
    }
    writeConfig(configPath, { ...readConfig(configPath), repoPath: expanded })
    return { ok: true }
  })

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

  ipcMain.handle('get-repo-status', async (): Promise<import('@shared/api').RepoStatus> => {
    const cfg = readConfig(configPath)
    const empty: import('@shared/api').RepoStatus = {
      clean: true, added: [], modified: [], deletions: [], unreadable: [], floorBlocked: [],
    }
    if (!cfg.repoPath) return empty
    const status = await refreshStatus({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      doFetch: false,
      syncGlobal: cfg.claude.syncGlobal,
    })
    const added = status.diffs.filter((d) => d.status === 'added').map((d) => d.repoPath)
    const modified = status.diffs.filter((d) => d.status === 'modified').map((d) => d.repoPath)
    const deletions = status.diffs.filter((d) => d.status === 'deleted').map((d) => d.repoPath)
    const unreadable = status.diffs.filter((d) => d.status === 'unreadable').map((d) => d.repoPath)
    const clean = added.length === 0 && modified.length === 0 && deletions.length === 0
    return { clean, added, modified, deletions, unreadable, floorBlocked: [] }
  })

  const refKeyLabel = (s: import('@shared/sync-types').SourceRef): string =>
    s.kind === 'claude-global' ? 'Claude (global)'
    : s.kind === 'claude-project-memory' ? `Claude memory: ${s.projectName}`
    : s.kind === 'claude-project-dotclaude' ? `Claude project: ${s.projectName}`
    : `Cursor: ${s.projectName}`

  ipcMain.handle('preview-push-status', async (): Promise<import('@shared/api').RepoStatus> => {
    const cfg = readConfig(configPath)
    const empty: import('@shared/api').RepoStatus = {
      clean: true, added: [], modified: [], deletions: [], unreadable: [], floorBlocked: [],
    }
    if (!cfg.repoPath) return empty
    const preview = await computePushPreview({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      doFetch: false,
      syncGlobal: cfg.claude.syncGlobal,
    })
    if (preview.kind === 'floor-blocked') {
      return {
        clean: false, added: [], modified: [], deletions: [], unreadable: [],
        floorBlocked: preview.verdicts.map((v) => ({
          source: refKeyLabel(v.source), headCount: v.headCount, deleting: v.deleting, reason: v.reason,
        })),
      }
    }
    if (preview.kind !== 'preview') return empty
    const added = preview.items.filter((d) => d.status === 'added').map((d) => d.repoPath)
    const modified = preview.items.filter((d) => d.status === 'modified').map((d) => d.repoPath)
    const deletions = preview.deletions.map((d) => d.repoPath)
    const unreadable = preview.unreadable.map((d) => d.repoPath)
    const clean = added.length === 0 && modified.length === 0 && deletions.length === 0
    return { clean, added, modified, deletions, unreadable, floorBlocked: [] }
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
    if (isLocked()) return { ...cachedSyncStatus, busy: true }
    const cfg = readConfig(configPath)
    if (cachedSyncStatus.fetchedAt !== null) {
      const fresh = await getSyncStatus({
        repoPath: cfg.repoPath,
        claudePath: cfg.claude.enabled ? cfg.claude.path : null,
        claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
        cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
        userDataDir,
        doFetch: false,
        syncGlobal: cfg.claude.syncGlobal,
      })
      cachedSyncStatus = { ...fresh, fetchedAt: cachedSyncStatus.fetchedAt }
      return cachedSyncStatus
    }
    cachedSyncStatus = await getSyncStatus({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      userDataDir,
      doFetch: false,
      syncGlobal: cfg.claude.syncGlobal,
    })
    return cachedSyncStatus
  })
  ipcMain.handle('refresh-sync-status', async () => {
    if (isLocked()) return { ...cachedSyncStatus, busy: true }
    const cfg = readConfig(configPath)
    cachedSyncStatus = await getSyncStatus({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      userDataDir,
      doFetch: true,
      syncGlobal: cfg.claude.syncGlobal,
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

  ipcMain.handle('run-push', async (_e, opts: PushOptions) => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath) return { ok: false, exitCode: -1, error: { key: 'push.error.notConfigured' } } as RunResult
    emitPushStep({ step: 'export', status: 'running' })
    emitPushStep({ step: 'export', status: 'done' })
    emitPushStep({ step: 'pull', status: 'running' })
    emitPushStep({ step: 'pull', status: 'done' })
    emitPushStep({ step: 'commit', status: 'running' })
    const r = await withExclusiveLock('push', () => executePush({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      commitMessage: opts.commitMessage,
      approvedDeletions: opts.approvedDeletions ?? [],
      syncGlobal: cfg.claude.syncGlobal,
    }))
    if (r.kind === 'ok') {
      emitPushStep({ step: 'commit', status: 'done' })
      emitPushStep({ step: 'push', status: 'running' })
      emitPushStep({ step: 'push', status: 'done' })
      return { ok: true, exitCode: 0 } as RunResult
    }
    if (r.kind === 'nothing-to-push') {
      return { ok: true, exitCode: 0, error: { key: 'push.info.nothingToPush' } } as RunResult
    }
    if (r.kind === 'diverged') {
      return { ok: false, exitCode: -1, error: { key: 'push.error.conflict', params: { repoPath: cfg.repoPath } }, kind: 'conflict' } as RunResult
    }
    if (r.kind === 'offline') return { ok: false, exitCode: -1, error: { key: 'push.error.network', params: { tail: '' } } } as RunResult
    if (r.kind === 'auth') return { ok: false, exitCode: -1, error: { key: 'push.error.auth', params: { tail: r.message } } } as RunResult
    if (r.kind === 'race') return { ok: false, exitCode: -1, error: { key: 'push.error.conflict', params: { repoPath: cfg.repoPath } }, kind: 'conflict' } as RunResult
    if (r.kind === 'floor-blocked') {
      return { ok: false, exitCode: -1, error: { key: 'push.error.floorBlocked' } } as RunResult
    }
    return { ok: false, exitCode: -1, error: { key: 'push.error.pullOther', fallback: r.kind === 'error' ? r.message : '' } } as RunResult
  })

  ipcMain.handle('open-repo-file', async (_e, relPath: string) => {
    const cfg = readConfig(configPath)
    if (!cfg.repoPath || !relPath) return
    // Strip trailing slash that `git status --porcelain` adds for untracked dirs.
    const cleaned = relPath.replace(/[/\\]+$/, '')
    await shell.openPath(join(cfg.repoPath, cleaned))
  })

  ipcMain.handle('run-repo-git-diag', async (_e, cmd: unknown) => {
    const cfg = readConfig(configPath)
    // isGitDiagCmd gates the payload — only the four read-only commands run;
    // the args themselves are fixed in gitDiagArgs, so nothing user-supplied
    // reaches the spawn. These are local, instant reads — no timeout needed.
    if (!cfg.repoPath || !isGitDiagCmd(cmd)) return
    const args = gitDiagArgs(cmd)
    emit({ time: nowHHMMSS(), text: `$ git ${args.join(' ')}`, level: 'info' })
    try {
      await runCommand('git', args, { cwd: cfg.repoPath, onLine: emit })
    } catch (e) {
      emit({ time: nowHHMMSS(), text: `git: ${(e as Error).message}`, level: 'error' })
    }
  })

  ipcMain.handle('open-repo-folder', async () => {
    const cfg = readConfig(configPath)
    if (cfg.repoPath) await shell.openPath(cfg.repoPath)
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
    // Target-aware: only prompt when the repo holds content the install
    // targets are actually missing — so the button doesn't nag once a machine
    // is set up (it used to fire on every launch if the repo was non-empty).
    return isInstallNeeded({
      repoPath: cfg.repoPath,
      claudeEnabled: cfg.claude.enabled,
      claudePath: cfg.claude.path,
      cursorEnabled: cfg.cursor.enabled,
      cursorProjects: cfg.cursor.projects,
    })
  })

  ipcMain.handle('compute-pull-preview', async () => {
    const cfg = readConfig(configPath)
    return computePullPreview({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      syncGlobal: cfg.claude.syncGlobal,
    })
  })

  ipcMain.handle('execute-pull-apply', async (_e, deletionsToApply: string[]) => {
    const cfg = readConfig(configPath)
    emit({ time: nowHHMMSS(), text: '$ engine pull-apply', level: 'info' })
    const r = await withExclusiveLock('pull-apply', () => executePullApply({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      deletionsToApply,
      syncGlobal: cfg.claude.syncGlobal,
      userDataDir,
    }))
    if (r.kind === 'ok') {
      emit({ time: nowHHMMSS(), text: '✓ Pull applied', level: 'success' })
      return { ok: true, exitCode: 0 } as RunResult
    }
    if (r.kind === 'diverged') return { ok: false, exitCode: -1, error: { key: 'push.error.conflict' }, kind: 'conflict' } as RunResult
    return { ok: false, exitCode: -1, error: { key: 'pull.error.failed', fallback: 'message' in r ? r.message : '' } } as RunResult
  })

  ipcMain.handle('discard-local-changes', async (_e, deleteAdded?: boolean): Promise<RunResult> => {
    const cfg = readConfig(configPath)
    emit({ time: nowHHMMSS(), text: '$ engine discard', level: 'info' })
    const r = await withExclusiveLock('discard', () => executeDiscard({
      repoPath: cfg.repoPath,
      claudePath: cfg.claude.enabled ? cfg.claude.path : null,
      claudeProjects: cfg.claude.enabled ? cfg.claude.projects : [],
      cursorProjects: cfg.cursor.enabled ? cfg.cursor.projects : [],
      token: loadToken(userDataDir),
      deleteAdded: deleteAdded === true,
      syncGlobal: cfg.claude.syncGlobal,
      userDataDir,
    }))
    if (r.kind === 'ok') {
      emit({ time: nowHHMMSS(), text: '✓ Local changes discarded', level: 'success' })
      return { ok: true, exitCode: 0 }
    }
    return { ok: false, exitCode: -1, error: { key: 'discard.error.failed', fallback: r.message } }
  })

  ipcMain.handle('run-install', (_e, opts: InstallOptions): Promise<RunResult> => withExclusiveLock('install', async (): Promise<RunResult> => {
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
        installCursorProjects(repoPath, selected, userDataDir, emit)
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
  }))

  // Conflict resolver (Engine-based)
  ipcMain.handle('resolver-get-state', () => getResolverStateIPC(configPath, userDataDir))
  ipcMain.handle(
    'resolver-execute',
    (_e, commitMessage: string, resolutions: ResolverState) =>
      withExclusiveLock('resolve', () => executeResolveIPC(configPath, userDataDir, commitMessage, resolutions)),
  )
  ipcMain.handle('resolver-discard', () => {
    discardResolverIPC(userDataDir)
  })

  ipcMain.handle('rescan-claude-projects', () => {
    const cfg = readConfig(configPath)
    if (!cfg.claude.enabled || !cfg.claude.path) return cfg.claude.projects
    const next = detectClaudeProjects(cfg.claude.path, cfg.claude.projects)
    if (next !== cfg.claude.projects) {
      writeConfig(configPath, { ...cfg, claude: { ...cfg.claude, projects: next } })
    }
    return next
  })

  // ─── MCP servers (per-project, ~/.claude.json, not synced) ──────────────────
  ipcMain.handle('list-mcp-projects', (): string[] => listMcpProjects())

  ipcMain.handle('pick-project-path', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0] ?? null
  })

  ipcMain.handle('get-mcp-server', (_e, projectPath: string, serverId: string) =>
    getMcpServer(projectPath, serverId),
  )

  ipcMain.handle('install-mcp-server', async (_e, req: McpInstallRequest): Promise<McpResult> => {
    const def = MCP_SERVERS.find((s) => s.id === req.serverId)
    if (!def) return { ok: false, error: { key: 'mcp.error.unknownServer' } }
    try {
      const uvx = await ensureUv(emit)
      if (!uvx) return { ok: false, error: { key: 'mcp.error.uvMissing' } }
      await prewarm(uvx, def.packageSpec, emit)
      setMcpServer(req.projectPath, req.serverId, {
        command: uvx,
        args: [def.packageSpec],
        env: req.env,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: { key: 'mcp.error.install', params: { reason: (e as Error).message } } }
    }
  })

  ipcMain.handle(
    'uninstall-mcp-server',
    async (_e, projectPath: string, serverId: string): Promise<McpResult> => {
      const def = MCP_SERVERS.find((s) => s.id === serverId)
      try {
        removeMcpServer(projectPath, serverId)
        if (def) {
          const uvx = await resolveUvx(emit)
          if (uvx) await cleanCache(uvx, pkgName(def.packageSpec), emit)
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: { key: 'mcp.error.uninstall', params: { reason: (e as Error).message } } }
      }
    },
  )
}
