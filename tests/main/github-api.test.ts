import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

import { getUser, listOrgs, createRepo, listOwners } from '../../src/main/github-api'

beforeEach(() => fetchMock.mockReset())

describe('getUser', () => {
  it('returns user data', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'me' }) })
    expect(await getUser('tok')).toEqual({ login: 'me' })
  })
  it('throws on non-ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauth' })
    await expect(getUser('tok')).rejects.toThrow(/401/)
  })
})

describe('listOrgs', () => {
  it('returns array of orgs', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ login: 'org1' }, { login: 'org2' }],
    })
    expect(await listOrgs('tok')).toEqual([{ login: 'org1' }, { login: 'org2' }])
  })
})

describe('listOwners', () => {
  it('combines user + orgs', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'me' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ login: 'org1' }] })
    const owners = await listOwners('tok')
    expect(owners).toEqual([
      { login: 'me', type: 'User' },
      { login: 'org1', type: 'Organization' },
    ])
  })
})

describe('createRepo', () => {
  it('uses /user/repos when owner == authenticated user', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'me' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clone_url: 'https://github.com/me/r.git',
          html_url: 'https://github.com/me/r',
          full_name: 'me/r',
        }),
      })
    const repo = await createRepo('tok', { owner: 'me', name: 'r', isPrivate: true })
    expect(repo.clone_url).toBe('https://github.com/me/r.git')
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.github.com/user/repos')
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string)
    expect(body).toEqual({ name: 'r', private: true, auto_init: false })
  })

  it('uses /orgs/<owner>/repos for org', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'me' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clone_url: 'x', html_url: 'y', full_name: 'org/r' }),
      })
    await createRepo('tok', { owner: 'org', name: 'r', isPrivate: false })
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.github.com/orgs/org/repos')
  })

  it('throws on 422 (name taken)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'me' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => '{"message":"name already exists"}',
      })
    await expect(
      createRepo('tok', { owner: 'me', name: 'r', isPrivate: true }),
    ).rejects.toThrow(/422/)
  })

  it('passes description when provided', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'me' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clone_url: 'x', html_url: 'y', full_name: 'me/r' }),
      })
    await createRepo('tok', { owner: 'me', name: 'r', isPrivate: true, description: 'hi' })
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string)
    expect(body.description).toBe('hi')
  })
})
