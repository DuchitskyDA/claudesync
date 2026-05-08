import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

const saveTokenMock = vi.hoisted(() => vi.fn())
const loadTokenMock = vi.hoisted(() => vi.fn())
const deleteTokenMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/safe-storage', () => ({
  saveToken: saveTokenMock,
  loadToken: loadTokenMock,
  deleteToken: deleteTokenMock,
}))

import {
  startDeviceFlow,
  pollDeviceFlow,
  cancelDeviceFlow,
  getAuthState,
  signOut,
  resetForTests,
} from '../../src/main/github-auth'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-auth-'))
  fetchMock.mockReset()
  saveTokenMock.mockClear()
  loadTokenMock.mockReset()
  deleteTokenMock.mockClear()
  resetForTests()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('startDeviceFlow', () => {
  it('returns user-facing challenge data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dev123',
        user_code: 'WXYZ-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 5,
        expires_in: 900,
      }),
    })
    const r = await startDeviceFlow()
    expect(r.userCode).toBe('WXYZ-1234')
    expect(r.verificationUri).toBe('https://github.com/login/device')
    expect(r.interval).toBe(5)
    expect(r.expiresIn).toBe(900)
  })

  it('throws when GitHub returns non-ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'oops' })
    await expect(startDeviceFlow()).rejects.toThrow(/500/)
  })
})

describe('pollDeviceFlow', () => {
  it('returns authorization_pending error then ok on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dev123',
        user_code: 'X',
        verification_uri: 'u',
        interval: 1,
        expires_in: 900,
      }),
    })
    await startDeviceFlow()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'authorization_pending' }),
    })
    const r1 = await pollDeviceFlow(dir)
    expect(r1).toEqual({ ok: false, error: 'authorization_pending' })
    expect(saveTokenMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'gho_real', scope: 'repo,read:user' }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ login: 'duchitskyda' }),
    })
    const r2 = await pollDeviceFlow(dir)
    expect(r2).toEqual({ ok: true })
    expect(saveTokenMock).toHaveBeenCalledWith(dir, 'gho_real')
  })

  it('returns expired_token error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dev123',
        user_code: 'X',
        verification_uri: 'u',
        interval: 1,
        expires_in: 900,
      }),
    })
    await startDeviceFlow()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'expired_token' }),
    })
    const r = await pollDeviceFlow(dir)
    expect(r).toEqual({ ok: false, error: 'expired_token' })
  })

  it('returns slow_down error (retry hint)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dev123',
        user_code: 'X',
        verification_uri: 'u',
        interval: 1,
        expires_in: 900,
      }),
    })
    await startDeviceFlow()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'slow_down' }),
    })
    const r = await pollDeviceFlow(dir)
    expect(r).toEqual({ ok: false, error: 'slow_down' })
  })

  it('returns error if no flow started', async () => {
    const r = await pollDeviceFlow(dir)
    expect(r).toEqual({ ok: false, error: 'no_active_flow' })
  })
})

describe('cancelDeviceFlow', () => {
  it('clears in-memory flow state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dev123',
        user_code: 'X',
        verification_uri: 'u',
        interval: 1,
        expires_in: 900,
      }),
    })
    await startDeviceFlow()
    await cancelDeviceFlow()
    const r = await pollDeviceFlow(dir)
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: string }).error).toBe('no_active_flow')
  })
})

describe('getAuthState', () => {
  it('returns authenticated:false when no token', async () => {
    loadTokenMock.mockReturnValue(null)
    const r = await getAuthState(dir)
    expect(r).toEqual({ authenticated: false })
  })

  it('returns authenticated:true with login when token valid', async () => {
    loadTokenMock.mockReturnValue('gho_real')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ login: 'duchitskyda' }),
    })
    const r = await getAuthState(dir)
    expect(r).toEqual({ authenticated: true, login: 'duchitskyda' })
  })

  it('returns authenticated:false when token invalid (401)', async () => {
    loadTokenMock.mockReturnValue('gho_old')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })
    const r = await getAuthState(dir)
    expect(r).toEqual({ authenticated: false })
    expect(deleteTokenMock).toHaveBeenCalledWith(dir)
  })
})

describe('signOut', () => {
  it('deletes token', () => {
    signOut(dir)
    expect(deleteTokenMock).toHaveBeenCalledWith(dir)
  })
})
