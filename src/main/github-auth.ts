import type { DeviceFlowChallenge, DeviceFlowResult, GitHubAuthState } from '@shared/api'
import { saveToken, loadToken, deleteToken } from './safe-storage'

// Client ID from registered OAuth App "claudesync" under DuchitskyDA.
// Public ID — safe to commit. Device Flow needs no client secret.
const OAUTH_CLIENT_ID = 'Ov23liiFZo3yiE6ngANA'
const SCOPE = 'repo read:user'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'

type FlowState = {
  deviceCode: string
  expiresAt: number
}

let activeFlow: FlowState | null = null

export function resetForTests(): void {
  activeFlow = null
}

export async function startDeviceFlow(): Promise<DeviceFlowChallenge> {
  const r = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, scope: SCOPE }),
  })
  if (!r.ok) {
    throw new Error(`device-code endpoint returned ${r.status}: ${await r.text()}`)
  }
  const data = (await r.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }
  activeFlow = {
    deviceCode: data.device_code,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

export async function pollDeviceFlow(userDataDir: string): Promise<DeviceFlowResult> {
  if (!activeFlow) return { ok: false, error: 'no_active_flow' }
  if (Date.now() > activeFlow.expiresAt) {
    activeFlow = null
    return { ok: false, error: 'expired_token' }
  }

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      device_code: activeFlow.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  if (!r.ok) return { ok: false, error: `http_${r.status}` }
  const data = (await r.json()) as { error: string } | { access_token: string; scope: string }

  if ('error' in data) {
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      return { ok: false, error: data.error }
    }
    activeFlow = null
    return { ok: false, error: data.error }
  }

  // Success — verify token by fetching user, then persist
  const userResp = await fetch(USER_URL, {
    headers: {
      Authorization: `Bearer ${data.access_token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!userResp.ok) {
    return { ok: false, error: 'token_verification_failed' }
  }
  saveToken(userDataDir, data.access_token)
  activeFlow = null
  return { ok: true }
}

export async function cancelDeviceFlow(): Promise<void> {
  activeFlow = null
}

export async function getAuthState(userDataDir: string): Promise<GitHubAuthState> {
  const token = loadToken(userDataDir)
  if (!token) return { authenticated: false }
  const r = await fetch(USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (r.status === 401 || r.status === 403) {
    deleteToken(userDataDir)
    return { authenticated: false }
  }
  if (!r.ok) return { authenticated: false }
  const data = (await r.json()) as { login: string }
  return { authenticated: true, login: data.login }
}

export function signOut(userDataDir: string): void {
  deleteToken(userDataDir)
}

/** Token getter for downstream main-process modules (init/push). Not exposed via IPC. */
export function getActiveToken(userDataDir: string): string | null {
  return loadToken(userDataDir)
}
