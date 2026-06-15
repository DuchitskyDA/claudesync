import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCommandMock = vi.hoisted(() => vi.fn())
const readConfigMock = vi.hoisted(() => vi.fn())
const validateLocalRepoMock = vi.hoisted(() => vi.fn())
const validateRepoUrlMock = vi.hoisted(() => vi.fn())
const validateClaudePathMock = vi.hoisted(() => vi.fn())
const validateCursorProjectMock = vi.hoisted(() => vi.fn())
const validateCatalogUrlMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn())
const mkdirSyncMock = vi.hoisted(() => vi.fn())
const rmSyncMock = vi.hoisted(() => vi.fn())
const fetchCatalogMock = vi.hoisted(() => vi.fn())
const getInstalledMock = vi.hoisted(() => vi.fn())
const applyChangesMock = vi.hoisted(() => vi.fn())
const settingsPathForMock = vi.hoisted(() => vi.fn())
const validateClaudeTargetMock = vi.hoisted(() => vi.fn())
const findClaudeBinMock = vi.hoisted(() => vi.fn())
const runPluginInstallsMock = vi.hoisted(() => vi.fn())

// Capture ipcMain.handle registrations
const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const ipcMainHandleMock = vi.hoisted(() => vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  ipcHandlers.set(channel, handler)
}))
const appGetPathMock = vi.hoisted(() => vi.fn(() => '/tmp/userData'))
const appGetLocaleMock = vi.hoisted(() => vi.fn(() => 'en-US'))

vi.mock('../../src/main/runner', () => ({
  runCommand: runCommandMock,
}))
vi.mock('../../src/main/sync/engine/op-lock', () => ({
  withExclusiveLock: <T,>(_n: string, task: () => Promise<T>) => task(),
  isLocked: () => false,
}))
vi.mock('../../src/main/config', () => ({
  readConfig: readConfigMock,
  validateLocalRepo: validateLocalRepoMock,
  validateRepoUrl: validateRepoUrlMock,
  validateClaudePath: validateClaudePathMock,
  validateCursorProject: validateCursorProjectMock,
  validateCatalogUrl: validateCatalogUrlMock,
  writeConfig: vi.fn(),
  expandTilde: vi.fn((p: string) => p),
  detectClaudeTarget: vi.fn(() => null),
  suggestedClaudeTargetPath: vi.fn(() => '/home/user/.claude'),
  defaultManagedRepoPath: vi.fn((url: string) => `/managed/${url}`),
}))
vi.mock('../../src/main/sync/cursor-validation', () => ({
  validateCursorProjects: vi.fn(() => ({ ok: true })),
  validateCursorProject: validateCursorProjectMock,
}))
vi.mock('../../src/main/catalog', () => ({
  fetchCatalog: fetchCatalogMock,
}))
vi.mock('../../src/main/plugins', () => ({
  getInstalled: getInstalledMock,
  applyChanges: applyChangesMock,
  settingsPathFor: settingsPathForMock,
  validateClaudeTarget: validateClaudeTargetMock,
}))
vi.mock('../../src/main/plugin-installer', () => ({
  findClaudeBin: findClaudeBinMock,
  runPluginInstalls: runPluginInstallsMock,
}))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: existsSyncMock, mkdirSync: mkdirSyncMock, rmSync: rmSyncMock, writeFileSync: vi.fn() }
})
vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  app: {
    getPath: appGetPathMock,
    getLocale: appGetLocaleMock,
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: vi.fn(),
  shell: { openExternal: vi.fn() },
  screen: { getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })) },
}))
// electron-updater is loaded transitively via auto-updater.ts; mock it so
// the module doesn't try to talk to GitHub during test setup.
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      allowPrerelease: false,
      on: vi.fn(),
      checkForUpdates: vi.fn(async () => ({})),
      downloadUpdate: vi.fn(async () => []),
      quitAndInstall: vi.fn(),
    },
  },
}))

import { registerIpc } from '../../src/main/ipc'

function makeConfig(overrides: {
  repoPath?: string | null
  repoUrl?: string | null
  rulesTarget?: string | null
  catalogUrl?: string | null
} = {}): Record<string, unknown> {
  const repoPath = 'repoPath' in overrides ? overrides.repoPath : '/repo'
  const repoUrl = 'repoUrl' in overrides ? overrides.repoUrl : 'https://github.com/org/repo'
  const rulesTarget = 'rulesTarget' in overrides ? overrides.rulesTarget : '/home/user/.claude'
  const catalogUrl = 'catalogUrl' in overrides ? overrides.catalogUrl : null
  return {
    repoPath,
    repoUrl,
    includeSecretsInPush: false,
    locale: null,
    lastDismissedUpdate: null,
    claude: { enabled: !!rulesTarget, path: rulesTarget },
    cursor: { enabled: false, projects: [] },
    catalogUrl,
    rulesTarget, // transitional shim mirroring claude.path
  }
}

const fullConfig = makeConfig()

// Helper: register ipc handlers and retrieve a specific channel handler
function getHandler(channel: string): (...args: unknown[]) => unknown {
  ipcHandlers.clear()
  const fakeBrowserWindow = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as import('electron').BrowserWindow
  registerIpc(fakeBrowserWindow)
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  return handler
}

beforeEach(() => {
  runCommandMock.mockReset()
  readConfigMock.mockReset()
  validateLocalRepoMock.mockReset()
  validateRepoUrlMock.mockReset()
  validateClaudePathMock.mockReset()
  validateCursorProjectMock.mockReset()
  validateCatalogUrlMock.mockReset()
  existsSyncMock.mockReset()
  mkdirSyncMock.mockReset()
  rmSyncMock.mockReset()
  // default: all validators pass
  validateRepoUrlMock.mockReturnValue({ ok: true })
  validateLocalRepoMock.mockReturnValue({ ok: true })
  validateClaudePathMock.mockReturnValue({ ok: true })
  validateCursorProjectMock.mockReturnValue({ ok: true })
  validateCatalogUrlMock.mockReturnValue({ ok: true })
})

// ---------------------------------------------------------------------------
// registerIpc — new plugin handlers
// ---------------------------------------------------------------------------
describe('registerIpc plugin handlers', () => {
  beforeEach(() => {
    fetchCatalogMock.mockReset()
    getInstalledMock.mockReset()
    applyChangesMock.mockReset()
    settingsPathForMock.mockReset()
    validateClaudeTargetMock.mockReset()
    readConfigMock.mockReset()
    findClaudeBinMock.mockReset()
    runPluginInstallsMock.mockReset()
    // Defaults: CLI present and installs succeed unless a test overrides.
    findClaudeBinMock.mockReturnValue('/usr/local/bin/claude')
    runPluginInstallsMock.mockResolvedValue({ ok: true, errors: [] })
  })

  describe('get-plugin-catalog', () => {
    it('calls fetchCatalog without force and with null catalogUrl by default', async () => {
      readConfigMock.mockReturnValue(makeConfig())
      const mockCatalog = { version: 1 as const, plugins: [], presets: [] }
      fetchCatalogMock.mockResolvedValueOnce(mockCatalog)
      const handler = getHandler('get-plugin-catalog')
      const result = await handler({} /* event */)
      expect(fetchCatalogMock).toHaveBeenCalledWith({ force: undefined, catalogUrl: null })
      expect(result).toEqual(mockCatalog)
    })

    it('passes force=true to fetchCatalog', async () => {
      readConfigMock.mockReturnValue(makeConfig())
      const mockCatalog = { version: 1 as const, plugins: [], presets: [] }
      fetchCatalogMock.mockResolvedValueOnce(mockCatalog)
      const handler = getHandler('get-plugin-catalog')
      await handler({} /* event */, true)
      expect(fetchCatalogMock).toHaveBeenCalledWith({ force: true, catalogUrl: null })
    })

    it('forwards a user-configured catalogUrl override', async () => {
      readConfigMock.mockReturnValue(
        makeConfig({ catalogUrl: 'https://example.com/catalog.json' }),
      )
      const mockCatalog = { version: 1 as const, plugins: [], presets: [] }
      fetchCatalogMock.mockResolvedValueOnce(mockCatalog)
      const handler = getHandler('get-plugin-catalog')
      await handler({} /* event */)
      expect(fetchCatalogMock).toHaveBeenCalledWith({
        force: undefined,
        catalogUrl: 'https://example.com/catalog.json',
      })
    })
  })

  describe('get-installed-plugins', () => {
    it('returns empty state when rulesTarget is null', () => {
      readConfigMock.mockReturnValue(makeConfig({ repoPath: null, repoUrl: null, rulesTarget: null }))
      const handler = getHandler('get-installed-plugins')
      const result = handler({})
      expect(result).toEqual({ enabledIds: [], envSet: [], knownMarketplaces: [] })
      expect(getInstalledMock).not.toHaveBeenCalled()
    })

    it('calls getInstalled with settingsPath when rulesTarget is set', () => {
      readConfigMock.mockReturnValue(fullConfig)
      settingsPathForMock.mockReturnValue('/home/user/.claude/settings.json')
      const mockState = { enabledIds: ['p1'], envSet: [], knownMarketplaces: [] }
      getInstalledMock.mockReturnValue(mockState)
      const handler = getHandler('get-installed-plugins')
      const result = handler({})
      expect(settingsPathForMock).toHaveBeenCalledWith(fullConfig.rulesTarget)
      expect(getInstalledMock).toHaveBeenCalledWith('/home/user/.claude/settings.json')
      expect(result).toEqual(mockState)
    })
  })

  describe('apply-plugin-changes', () => {
    it('returns error when rulesTarget is null', async () => {
      readConfigMock.mockReturnValue(makeConfig({ repoPath: null, repoUrl: null, rulesTarget: null }))
      const handler = getHandler('apply-plugin-changes')
      const result = await handler({}, { enable: [], disable: [], envValues: {} })
      expect(result).toEqual({ ok: false, error: { key: 'config.error.targetRequired' } })
      expect(applyChangesMock).not.toHaveBeenCalled()
    })

    it('runs the CLI uninstall then writes settings for a disable', async () => {
      readConfigMock.mockReturnValue(fullConfig)
      settingsPathForMock.mockReturnValue('/home/user/.claude/settings.json')
      applyChangesMock.mockReturnValue({ ok: true })
      const changes = { enable: [], disable: ['old-plugin'], envValues: {} }
      const handler = getHandler('apply-plugin-changes')
      const result = await handler({}, changes)
      expect(runPluginInstallsMock).toHaveBeenCalledWith('/usr/local/bin/claude', [], ['old-plugin'])
      expect(applyChangesMock).toHaveBeenCalledWith('/home/user/.claude/settings.json', changes, '/tmp/userData')
      expect(result).toEqual({ ok: true })
    })

    it('writes settings only (no CLI) when there are no enable/disable ops', async () => {
      readConfigMock.mockReturnValue(fullConfig)
      settingsPathForMock.mockReturnValue('/home/user/.claude/settings.json')
      applyChangesMock.mockReturnValue({ ok: true })
      const changes = { enable: [], disable: [], envValues: { KEY: 'v' } }
      const handler = getHandler('apply-plugin-changes')
      const result = await handler({}, changes)
      expect(runPluginInstallsMock).not.toHaveBeenCalled()
      expect(applyChangesMock).toHaveBeenCalledWith('/home/user/.claude/settings.json', changes, '/tmp/userData')
      expect(result).toEqual({ ok: true })
    })

    it('returns cliNotFound and skips settings when the claude binary is missing', async () => {
      readConfigMock.mockReturnValue(fullConfig)
      settingsPathForMock.mockReturnValue('/home/user/.claude/settings.json')
      findClaudeBinMock.mockReturnValue(null)
      const changes = { enable: [{ id: 'p@m', name: 'p', description: '' }], disable: [], envValues: {} }
      const handler = getHandler('apply-plugin-changes')
      const result = await handler({}, changes)
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ key: 'plugins.error.cliNotFound' }) })
      expect(runPluginInstallsMock).not.toHaveBeenCalled()
      expect(applyChangesMock).not.toHaveBeenCalled()
    })

    it('returns installFailed when the CLI reports an error', async () => {
      readConfigMock.mockReturnValue(fullConfig)
      settingsPathForMock.mockReturnValue('/home/user/.claude/settings.json')
      runPluginInstallsMock.mockResolvedValue({ ok: false, errors: ['p@m: boom'] })
      const changes = { enable: [{ id: 'p@m', name: 'p', description: '' }], disable: [], envValues: {} }
      const handler = getHandler('apply-plugin-changes')
      const result = await handler({}, changes)
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ key: 'plugins.error.installFailed' }) })
      expect(applyChangesMock).not.toHaveBeenCalled()
    })
  })

  describe('validate-claude-target', () => {
    it('calls validateClaudeTarget with rulesTarget from config', () => {
      readConfigMock.mockReturnValue(fullConfig)
      const mockCheck = { ok: true as const, settingsPath: '/home/user/.claude/settings.json' }
      validateClaudeTargetMock.mockReturnValue(mockCheck)
      const handler = getHandler('validate-claude-target')
      const result = handler({})
      expect(validateClaudeTargetMock).toHaveBeenCalledWith(fullConfig.rulesTarget)
      expect(result).toEqual(mockCheck)
    })

    it('returns ok:false when rulesTarget is null', () => {
      readConfigMock.mockReturnValue(makeConfig({ repoPath: null, repoUrl: null, rulesTarget: null }))
      validateClaudeTargetMock.mockReturnValue({ ok: false, reason: 'Rules target not configured' })
      const handler = getHandler('validate-claude-target')
      handler({})
      expect(validateClaudeTargetMock).toHaveBeenCalledWith(null)
    })
  })
})

// ---------------------------------------------------------------------------
// registerIpc — set-config handler
// ---------------------------------------------------------------------------
describe('registerIpc set-config', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    rmSyncMock.mockReset()
  })

  it('keeps repo dir of removed cursor project (toggle-off ≠ delete)', async () => {
    const repoPath = '/repo'
    const projectName = 'my-cursor-project'

    // Previous config has the cursor project
    const previousConfig = makeConfig({
      repoPath,
      repoUrl: 'https://github.com/org/repo',
      rulesTarget: '/home/user/.claude',
    })
    previousConfig.cursor = {
      enabled: true,
      projects: [{ name: projectName }],
    }

    // New config does NOT have the cursor project (user removed it)
    const newConfig = makeConfig({
      repoPath,
      repoUrl: 'https://github.com/org/repo',
      rulesTarget: '/home/user/.claude',
    })
    newConfig.cursor = { enabled: true, projects: [] }

    // Mock readConfig to return previous config on first call (inside handler)
    readConfigMock.mockReturnValue(previousConfig)

    // Mock file checks: project dir exists
    existsSyncMock.mockReturnValue(true)

    const handler = getHandler('set-config')
    const result = await handler({} /* event */, newConfig)

    // Expect success
    expect(result).toEqual({ ok: true })

    // CRITICAL: rmSync must NOT be called (repo dir is preserved)
    expect(rmSyncMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// registerIpc — get-system-locale handler
// ---------------------------------------------------------------------------
describe('registerIpc get-system-locale', () => {
  beforeEach(() => {
    appGetLocaleMock.mockReset()
  })

  it('returns locale from app.getLocale() — ru-RU', () => {
    appGetLocaleMock.mockReturnValue('ru-RU')
    const handler = getHandler('get-system-locale')
    const result = handler()
    expect(appGetLocaleMock).toHaveBeenCalled()
    expect(result).toBe('ru-RU')
  })

  it('returns locale from app.getLocale() — en-US (non-tautology check)', () => {
    appGetLocaleMock.mockReturnValue('en-US')
    const handler = getHandler('get-system-locale')
    const result = handler()
    expect(appGetLocaleMock).toHaveBeenCalled()
    expect(result).toBe('en-US')
  })
})
