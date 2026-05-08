import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCommandMock = vi.hoisted(() => vi.fn())
const withRunLockMock = vi.hoisted(() => vi.fn(async (task: () => Promise<unknown>) => task()))
const readConfigMock = vi.hoisted(() => vi.fn())
const validateLocalRepoMock = vi.hoisted(() => vi.fn())
const validateRepoUrlMock = vi.hoisted(() => vi.fn())
const validateRulesTargetMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn())
const mkdirSyncMock = vi.hoisted(() => vi.fn())
const fetchCatalogMock = vi.hoisted(() => vi.fn())
const getInstalledMock = vi.hoisted(() => vi.fn())
const applyChangesMock = vi.hoisted(() => vi.fn())
const settingsPathForMock = vi.hoisted(() => vi.fn())
const validateClaudeTargetMock = vi.hoisted(() => vi.fn())

// Capture ipcMain.handle registrations
const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const ipcMainHandleMock = vi.hoisted(() => vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  ipcHandlers.set(channel, handler)
}))
const appGetPathMock = vi.hoisted(() => vi.fn(() => '/tmp/userData'))

vi.mock('../../src/main/runner', () => ({
  runCommand: runCommandMock,
  withRunLock: withRunLockMock,
}))
vi.mock('../../src/main/config', () => ({
  readConfig: readConfigMock,
  validateLocalRepo: validateLocalRepoMock,
  validateRepoUrl: validateRepoUrlMock,
  validateRulesTarget: validateRulesTargetMock,
  writeConfig: vi.fn(),
  expandTilde: vi.fn((p: string) => p),
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
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: existsSyncMock, mkdirSync: mkdirSyncMock, writeFileSync: vi.fn() }
})
vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  app: { getPath: appGetPathMock },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: vi.fn(),
}))

import { runSyncHandler, registerIpc } from '../../src/main/ipc'

const noop = () => {}

const fullConfig = {
  repoPath: '/repo',
  repoUrl: 'https://github.com/org/repo',
  rulesTarget: '/home/user/.claude',
}

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
  validateRulesTargetMock.mockReset()
  existsSyncMock.mockReset()
  mkdirSyncMock.mockReset()
  withRunLockMock.mockClear()
  withRunLockMock.mockImplementation(async (task: () => Promise<unknown>) => task())

  // default: all validators pass
  validateRepoUrlMock.mockReturnValue({ ok: true })
  validateLocalRepoMock.mockReturnValue({ ok: true })
  validateRulesTargetMock.mockReturnValue({ ok: true })
})

describe('runSyncHandler', () => {
  it('fails when repoUrl is missing', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo', repoUrl: null, rulesTarget: '/target' })
    const r = await runSyncHandler({ currentPlatform: 'linux', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/repo url/i)
  })

  it('fails when repoPath is missing', async () => {
    readConfigMock.mockReturnValue({ repoPath: null, repoUrl: 'https://github.com/org/repo', rulesTarget: '/target' })
    const r = await runSyncHandler({ currentPlatform: 'linux', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/local repo path/i)
  })

  it('fails when rulesTarget is missing', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo', repoUrl: 'https://github.com/org/repo', rulesTarget: null })
    const r = await runSyncHandler({ currentPlatform: 'linux', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/rules target/i)
  })

  it('fails when URL validation fails', async () => {
    readConfigMock.mockReturnValue(fullConfig)
    validateRepoUrlMock.mockReturnValue({ ok: false, error: 'Invalid URL format' })
    const r = await runSyncHandler({ currentPlatform: 'linux', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Invalid URL format')
  })

  it('fresh clone: no .git → runs git clone then install.sh on linux', async () => {
    readConfigMock.mockReturnValue(fullConfig)
    // existsSync: .git path → false, then scriptPath → true
    existsSyncMock
      .mockReturnValueOnce(false)  // join(repoPath, '.git')
      .mockReturnValueOnce(true)   // join(repoPath, 'install.sh')
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0 }) // git clone
      .mockResolvedValueOnce({ exitCode: 0 }) // install.sh

    const r = await runSyncHandler({ currentPlatform: 'linux', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r).toEqual({ ok: true, exitCode: 0 })
    expect(runCommandMock).toHaveBeenCalledTimes(2)
    expect(runCommandMock.mock.calls[0]![0]).toBe('git')
    expect(runCommandMock.mock.calls[0]![1]).toEqual(['clone', fullConfig.repoUrl, fullConfig.repoPath])
    expect(runCommandMock.mock.calls[1]![0]).toBe('bash')
    expect(runCommandMock.mock.calls[1]![2]).toMatchObject({ env: { RULES_TARGET: fullConfig.rulesTarget } })
  })

  it('existing pull: .git present → runs git pull then install.sh', async () => {
    readConfigMock.mockReturnValue(fullConfig)
    // existsSync: .git → true (existing repo), then scriptPath → true
    existsSyncMock
      .mockReturnValueOnce(true)  // join(repoPath, '.git')
      .mockReturnValueOnce(true)  // join(repoPath, 'install.sh')
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0 }) // git pull
      .mockResolvedValueOnce({ exitCode: 0 }) // install.sh

    const r = await runSyncHandler({ currentPlatform: 'darwin', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r).toEqual({ ok: true, exitCode: 0 })
    expect(runCommandMock).toHaveBeenCalledTimes(2)
    expect(runCommandMock.mock.calls[0]![0]).toBe('git')
    expect(runCommandMock.mock.calls[0]![1]).toEqual(['pull'])
    expect(runCommandMock.mock.calls[1]![0]).toBe('bash')
  })

  it('fails if install script missing', async () => {
    readConfigMock.mockReturnValue(fullConfig)
    // .git exists (pull path), but no install script
    existsSyncMock
      .mockReturnValueOnce(true)  // .git
      .mockReturnValueOnce(false) // install.sh missing
    runCommandMock.mockResolvedValueOnce({ exitCode: 0 }) // git pull

    const r = await runSyncHandler({ currentPlatform: 'linux', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/install\.sh not found/i)
  })

  it('windows: uses powershell and install.ps1', async () => {
    readConfigMock.mockReturnValue(fullConfig)
    existsSyncMock
      .mockReturnValueOnce(true)  // .git
      .mockReturnValueOnce(true)  // install.ps1
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0 }) // git pull
      .mockResolvedValueOnce({ exitCode: 0 }) // install.ps1

    await runSyncHandler({ currentPlatform: 'win32', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(runCommandMock.mock.calls[1]![0]).toBe('powershell')
    expect(runCommandMock.mock.calls[1]![1]).toEqual([
      '-ExecutionPolicy', 'Bypass', '-File', expect.stringContaining('install.ps1'),
    ])
    expect(runCommandMock.mock.calls[1]![2]).toMatchObject({ env: { RULES_TARGET: fullConfig.rulesTarget } })
  })

  it('returns failure if git pull exits non-zero', async () => {
    readConfigMock.mockReturnValue(fullConfig)
    existsSyncMock.mockReturnValueOnce(true) // .git exists
    runCommandMock.mockResolvedValueOnce({ exitCode: 1 }) // git pull fails

    const r = await runSyncHandler({ currentPlatform: 'darwin', configPath: '/x', emit: noop, emitStep: vi.fn() })
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(1)
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })

  it('success path emits step events: fetch:running → fetch:done → install:running → install:done', async () => {
    readConfigMock.mockReturnValue(fullConfig)
    existsSyncMock
      .mockReturnValueOnce(true)  // .git exists (pull path)
      .mockReturnValueOnce(true)  // install.sh exists
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0 }) // git pull
      .mockResolvedValueOnce({ exitCode: 0 }) // install.sh

    const emitStep = vi.fn()
    const r = await runSyncHandler({ currentPlatform: 'linux', configPath: '/x', emit: noop, emitStep })
    expect(r).toEqual({ ok: true, exitCode: 0 })
    expect(emitStep).toHaveBeenCalledTimes(4)
    expect(emitStep).toHaveBeenNthCalledWith(1, { step: 'fetch', status: 'running' })
    expect(emitStep).toHaveBeenNthCalledWith(2, { step: 'fetch', status: 'done' })
    expect(emitStep).toHaveBeenNthCalledWith(3, { step: 'install', status: 'running' })
    expect(emitStep).toHaveBeenNthCalledWith(4, { step: 'install', status: 'done' })
  })
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
  })

  describe('get-plugin-catalog', () => {
    it('calls fetchCatalog without force by default', async () => {
      const mockCatalog = { version: 1 as const, plugins: [], presets: [] }
      fetchCatalogMock.mockResolvedValueOnce(mockCatalog)
      const handler = getHandler('get-plugin-catalog')
      const result = await handler({} /* event */)
      expect(fetchCatalogMock).toHaveBeenCalledWith({ force: undefined })
      expect(result).toEqual(mockCatalog)
    })

    it('passes force=true to fetchCatalog', async () => {
      const mockCatalog = { version: 1 as const, plugins: [], presets: [] }
      fetchCatalogMock.mockResolvedValueOnce(mockCatalog)
      const handler = getHandler('get-plugin-catalog')
      await handler({} /* event */, true)
      expect(fetchCatalogMock).toHaveBeenCalledWith({ force: true })
    })
  })

  describe('get-installed-plugins', () => {
    it('returns empty state when rulesTarget is null', () => {
      readConfigMock.mockReturnValue({ repoPath: null, repoUrl: null, rulesTarget: null })
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
    it('returns error when rulesTarget is null', () => {
      readConfigMock.mockReturnValue({ repoPath: null, repoUrl: null, rulesTarget: null })
      const handler = getHandler('apply-plugin-changes')
      const result = handler({}, { enable: [], disable: [], envValues: {} })
      expect(result).toEqual({ ok: false, error: 'Rules target not configured' })
      expect(applyChangesMock).not.toHaveBeenCalled()
    })

    it('calls applyChanges with correct settingsPath and changes', () => {
      readConfigMock.mockReturnValue(fullConfig)
      settingsPathForMock.mockReturnValue('/home/user/.claude/settings.json')
      applyChangesMock.mockReturnValue({ ok: true })
      const changes = { enable: [], disable: ['old-plugin'], envValues: {} }
      const handler = getHandler('apply-plugin-changes')
      const result = handler({}, changes)
      expect(applyChangesMock).toHaveBeenCalledWith('/home/user/.claude/settings.json', changes)
      expect(result).toEqual({ ok: true })
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
      readConfigMock.mockReturnValue({ repoPath: null, repoUrl: null, rulesTarget: null })
      validateClaudeTargetMock.mockReturnValue({ ok: false, reason: 'Rules target not configured' })
      const handler = getHandler('validate-claude-target')
      handler({})
      expect(validateClaudeTargetMock).toHaveBeenCalledWith(null)
    })
  })
})
