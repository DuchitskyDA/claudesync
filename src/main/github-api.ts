import type { CreateRepoOptions, GitHubOwner } from '@shared/api'

const API_BASE = 'https://api.github.com'

async function ghApi<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`GitHub API ${r.status}: ${body}`)
  }
  return (await r.json()) as T
}

export async function getUser(token: string): Promise<{ login: string }> {
  return ghApi(token, '/user')
}

export async function listOrgs(token: string): Promise<{ login: string }[]> {
  return ghApi(token, '/user/orgs')
}

export async function listOwners(token: string): Promise<GitHubOwner[]> {
  const [user, orgs] = await Promise.all([getUser(token), listOrgs(token)])
  return [
    { login: user.login, type: 'User' as const },
    ...orgs.map((o) => ({ login: o.login, type: 'Organization' as const })),
  ]
}

export type CreateRepoResult = {
  clone_url: string
  html_url: string
  full_name: string
}

export async function createRepo(
  token: string,
  opts: CreateRepoOptions,
): Promise<CreateRepoResult> {
  const user = await getUser(token)
  const isUserRepo = opts.owner === user.login
  const path = isUserRepo ? '/user/repos' : `/orgs/${opts.owner}/repos`
  const body: Record<string, unknown> = {
    name: opts.name,
    private: opts.isPrivate,
    auto_init: false,
  }
  if (opts.description) body.description = opts.description
  return ghApi<CreateRepoResult>(token, path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
