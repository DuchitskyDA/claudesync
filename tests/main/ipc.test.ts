import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCommandMock = vi.hoisted(() => vi.fn())
const withRunLockMock = vi.hoisted(() => vi.fn(async (task: () => Promise<unknown>) => task()))
const validateMock = vi.hoisted(() => vi.fn())
const readConfigMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/runner', () => ({
  runCommand: runCommandMock,
  withRunLock: withRunLockMock,
}))
vi.mock('../../src/main/config', () => ({
  readConfig: readConfigMock,
  validateRepoPath: validateMock,
  writeConfig: vi.fn(),
}))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: existsSyncMock }
})

import { runUpdateHandler } from '../../src/main/ipc'

beforeEach(() => {
  runCommandMock.mockReset()
  validateMock.mockReset()
  readConfigMock.mockReset()
  existsSyncMock.mockReset()
  withRunLockMock.mockClear()
  withRunLockMock.mockImplementation(async (task: () => Promise<unknown>) => task())
})

describe('runUpdateHandler', () => {
  const noop = () => {}

  it('rejects when current OS does not match requested platform', async () => {
    const r = await runUpdateHandler('macos', { currentPlatform: 'win32', configPath: '/x', emit: noop })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/platform/i)
  })

  it('rejects when repoPath is not configured', async () => {
    readConfigMock.mockReturnValue({ repoPath: null })
    const r = await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: noop })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/repo path/i)
  })

  it('rejects when repoPath fails validation', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: false, error: 'broken' })
    const r = await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: noop })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('broken')
  })

  it('rejects when install script missing for platform', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(false)
    const r = await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: noop })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/install\.ps1 not found/i)
  })

  it('runs git pull then install on success', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(true)
    runCommandMock.mockResolvedValueOnce({ exitCode: 0 }).mockResolvedValueOnce({ exitCode: 0 })
    const r = await runUpdateHandler('macos', { currentPlatform: 'darwin', configPath: '/x', emit: noop })
    expect(r).toEqual({ ok: true, exitCode: 0 })
    expect(runCommandMock).toHaveBeenCalledTimes(2)
    expect(runCommandMock.mock.calls[0]![0]).toBe('git')
    expect(runCommandMock.mock.calls[1]![0]).toBe('bash')
  })

  it('aborts and returns failure if git pull fails', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(true)
    runCommandMock.mockResolvedValueOnce({ exitCode: 1 })
    const r = await runUpdateHandler('macos', { currentPlatform: 'darwin', configPath: '/x', emit: noop })
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(1)
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })

  it('uses powershell on windows', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(true)
    runCommandMock.mockResolvedValue({ exitCode: 0 })
    await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: noop })
    expect(runCommandMock.mock.calls[1]![0]).toBe('powershell')
    expect(runCommandMock.mock.calls[1]![1]).toEqual([
      '-ExecutionPolicy', 'Bypass', '-File', expect.stringContaining('install.ps1'),
    ])
  })
})
