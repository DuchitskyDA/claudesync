import type { UpdateInfo } from '@shared/api'

const REPO = 'DuchitskyDA/claudesync'
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const FETCH_TIMEOUT_MS = 6000

export type LatestRelease = { tag: string; url: string; body: string }

/** Numeric semver compare; ignores leading "v" and any "-pre" / "+build" suffixes. */
export function compareVersion(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .replace(/^v/, '')
      .split(/[-+]/)[0]!
      .split('.')
      .map((p) => parseInt(p, 10) || 0)
  const pa = norm(a)
  const pb = norm(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

async function fetchWithTimeout(): Promise<Response | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(LATEST_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'claudesync',
      },
      signal: ctrl.signal,
    })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const r = await fetchWithTimeout()
  if (!r || !r.ok) return null
  try {
    const data = (await r.json()) as { tag_name: string; html_url: string; body: string }
    return { tag: data.tag_name, url: data.html_url, body: data.body ?? '' }
  } catch {
    return null
  }
}

let cached: UpdateInfo | null = null

export type CheckOpts = {
  current: string
  /** when true, hit the network; when false, return cached if any. */
  doFetch: boolean
}

export async function getUpdateInfo(opts: CheckOpts): Promise<UpdateInfo> {
  const { current, doFetch } = opts

  if (!doFetch && cached) {
    // Update `current` in case of a freshly-installed version while cache holds old result.
    return { ...cached, current }
  }

  const release = await fetchLatestRelease()
  if (!release) {
    // Network hiccup — keep returning cached info if we have it; otherwise empty.
    if (cached) return { ...cached, current }
    return {
      current,
      latest: null,
      available: false,
      releaseUrl: null,
      releaseNotes: null,
      checkedAt: null,
    }
  }

  const latestVersion = release.tag.replace(/^v/, '')
  const info: UpdateInfo = {
    current,
    latest: latestVersion,
    available: compareVersion(current, latestVersion) < 0,
    releaseUrl: release.url,
    releaseNotes: release.body || null,
    checkedAt: Date.now(),
  }
  cached = info
  return info
}

/** Test helper. */
export function _resetCache(): void {
  cached = null
}
