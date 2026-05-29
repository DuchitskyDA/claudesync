import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

// Mock token loader so getSyncStatus doesn't try to read real safeStorage.
vi.mock('../../src/main/safe-storage', () => ({
  loadToken: () => null,
}))

import { getSyncStatus } from '../../src/main/sync-status'

let dir: string
let local: string
let remote: string

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8' }).toString().trim()
}

function setupRemoteAndClone(): void {
  // Build a bare "remote" with one commit on main.
  remote = join(dir, 'remote.git')
  mkdirSync(remote)
  git('init -q --bare -b main', remote)

  // Build a "seed" that will populate the bare remote with main's first commit.
  const seed = join(dir, 'seed')
  mkdirSync(seed)
  git('init -q -b main', seed)
  git('config user.email t@e.com', seed)
  git('config user.name t', seed)
  git('config commit.gpgsign false', seed)
  writeFileSync(join(seed, 'README.md'), 'hello\n')
  git('add README.md', seed)
  git('commit -q -m base', seed)
  git(`remote add origin "${remote.replace(/\\/g, '/')}"`, seed)
  git('push -q origin main', seed)

  // Clone into local and pin upstream.
  local = join(dir, 'local')
  git(`clone -q "${remote.replace(/\\/g, '/')}" "${local.replace(/\\/g, '/')}"`, dir)
  git('config user.email t@e.com', local)
  git('config user.name t', local)
  git('config commit.gpgsign false', local)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-syncstatus-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('getSyncStatus', () => {
  it('returns no-remote when repoPath is null', async () => {
    const s = await getSyncStatus({ repoPath: null, claudePath: null, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: false })
    expect(s.state).toBe('no-remote')
    expect(s.behind).toBe(0)
    expect(s.ahead).toBe(0)
    expect(s.localChanges).toBe(0)
  })

  it('returns no-remote when path is not a git repo', async () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    const s = await getSyncStatus({ repoPath: empty, claudePath: null, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: false })
    expect(s.state).toBe('no-remote')
  })

  it('returns in-sync after a fresh clone', async () => {
    setupRemoteAndClone()
    const s = await getSyncStatus({ repoPath: local, claudePath: null, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: false })
    expect(s.state).toBe('in-sync')
    expect(s.behind).toBe(0)
    expect(s.ahead).toBe(0)
    expect(s.localChanges).toBe(0)
  })

  it('reports local-changes when Claude source has new file', async () => {
    setupRemoteAndClone()
    const claudePath = join(dir, '.claude')
    mkdirSync(claudePath)
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    const s = await getSyncStatus({ repoPath: local, claudePath, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: false })
    expect(s.state).toBe('local-changes')
    expect(s.behind).toBe(0)
    expect(s.ahead).toBe(0)
    expect(s.localChanges).toBe(1)
  })

  it('counts Claude changes as localChanges', async () => {
    setupRemoteAndClone()
    const claudePath = join(dir, '.claude')
    mkdirSync(claudePath)
    // repo HEAD has CLAUDE.md = "hello\n", we modify it and add 2 more
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'modified\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    writeFileSync(join(claudePath, 'extra.json'), '{}')
    const s = await getSyncStatus({ repoPath: local, claudePath, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: false })
    expect(s.state).toBe('local-changes')
    expect(s.localChanges).toBe(2) // 1 modified + 2 added
  })

  it('reports ahead after a local commit', async () => {
    setupRemoteAndClone()
    writeFileSync(join(local, 'a.txt'), 'A')
    git('add a.txt', local)
    git('commit -q -m local', local)
    const s = await getSyncStatus({ repoPath: local, claudePath: null, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: false })
    expect(s.state).toBe('ahead')
    expect(s.behind).toBe(0)
    expect(s.ahead).toBe(1)
  })

  it('reports behind after a remote commit (with fetch)', async () => {
    setupRemoteAndClone()
    // Push another commit via a sibling clone, then fetch from local.
    const sibling = join(dir, 'sibling')
    git(`clone -q "${remote.replace(/\\/g, '/')}" "${sibling.replace(/\\/g, '/')}"`, dir)
    git('config user.email t@e.com', sibling)
    git('config user.name t', sibling)
    git('config commit.gpgsign false', sibling)
    writeFileSync(join(sibling, 'b.txt'), 'B')
    git('add b.txt', sibling)
    git('commit -q -m remote', sibling)
    git('push -q origin main', sibling)

    const s = await getSyncStatus({ repoPath: local, claudePath: null, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: true })
    expect(s.state).toBe('behind')
    expect(s.behind).toBe(1)
    expect(s.ahead).toBe(0)
    expect(s.fetchedAt).toBeTypeOf('number')
  })

  it('reports diverged when remote moved AND Claude has changes (with fetch)', async () => {
    setupRemoteAndClone()
    // remote-side commit
    const sibling = join(dir, 'sibling-dirty')
    git(`clone -q "${remote.replace(/\\/g, '/')}" "${sibling.replace(/\\/g, '/')}"`, dir)
    git('config user.email t@e.com', sibling)
    git('config user.name t', sibling)
    git('config commit.gpgsign false', sibling)
    writeFileSync(join(sibling, 'rr.txt'), 'R')
    git('add rr.txt', sibling)
    git('commit -q -m remote', sibling)
    git('push -q origin main', sibling)
    // local: Claude changes, no commits
    const claudePath = join(dir, '.claude')
    mkdirSync(claudePath)
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    const s = await getSyncStatus({ repoPath: local, claudePath, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: true })
    // behind > 0 + Claude changes → diverged (potential conflict on pull)
    expect(s.state).toBe('diverged')
    expect(s.behind).toBe(1)
    expect(s.ahead).toBe(0)
    expect(s.localChanges).toBe(1)
  })

  it('reports diverged when both sides have commits (with fetch)', async () => {
    setupRemoteAndClone()
    // remote-side commit
    const sibling = join(dir, 'sibling')
    git(`clone -q "${remote.replace(/\\/g, '/')}" "${sibling.replace(/\\/g, '/')}"`, dir)
    git('config user.email t@e.com', sibling)
    git('config user.name t', sibling)
    git('config commit.gpgsign false', sibling)
    writeFileSync(join(sibling, 'r.txt'), 'R')
    git('add r.txt', sibling)
    git('commit -q -m remote', sibling)
    git('push -q origin main', sibling)
    // local-side commit
    writeFileSync(join(local, 'l.txt'), 'L')
    git('add l.txt', local)
    git('commit -q -m local', local)
    // local Claude changes
    const claudePath = join(dir, '.claude')
    mkdirSync(claudePath)
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')

    const s = await getSyncStatus({ repoPath: local, claudePath, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: true })
    expect(s.state).toBe('diverged')
    expect(s.behind).toBe(1)
    expect(s.ahead).toBe(1)
  })

  it('returns offline when fetch fails (unreachable origin)', async () => {
    setupRemoteAndClone()
    // Point origin at a path that does not exist — fetch must fail.
    git(`remote set-url origin "${join(dir, 'does-not-exist').replace(/\\/g, '/')}"`, local)
    const claudePath = join(dir, '.claude')
    mkdirSync(claudePath)
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    const s = await getSyncStatus({ repoPath: local, claudePath, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: true })
    expect(s.state).toBe('offline')
    // Engine doesn't set errorKey for offline state
  })

  it('returns in-sync when no upstream and no Claude changes', async () => {
    const orphan = join(dir, 'orphan')
    mkdirSync(orphan)
    git('init -q -b main', orphan)
    git('config user.email t@e.com', orphan)
    git('config user.name t', orphan)
    git('config commit.gpgsign false', orphan)
    writeFileSync(join(orphan, 'x.txt'), 'x')
    git('add x.txt', orphan)
    git('commit -q -m only', orphan)
    const claudePath = join(dir, '.claude')
    mkdirSync(claudePath)
    const s = await getSyncStatus({ repoPath: orphan, claudePath, claudeProjects: [], cursorProjects: [], userDataDir: dir, doFetch: false })
    // No remote + no Claude changes = in-sync
    expect(s.state).toBe('in-sync')
    expect(s.localChanges).toBe(0)
  })
})
