// tests/main/engine/resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computeResolverState, executeResolve, persistResolverState, loadResolverState, clearResolverState } from '../../../src/main/sync/engine/resolver'

let dir: string, claudePath: string, repoPath: string, remotePath: string, userDataDir: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-rsv-'))
  claudePath = join(dir, '.claude'); mkdirSync(claudePath)
  remotePath = join(dir, 'remote.git'); mkdirSync(remotePath)
  userDataDir = join(dir, 'ud'); mkdirSync(userDataDir)
  git(remotePath, ['init', '--bare', '-q', '-b', 'main'])
  repoPath = join(dir, 'repo'); mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  git(repoPath, ['config', 'core.autocrlf', 'false'])
  git(repoPath, ['remote', 'add', 'origin', remotePath])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'base\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'base'])
  git(repoPath, ['push', '-q', '-u', 'origin', 'main'])

  // Advance remote with theirs
  const other = join(dir, 'other')
  git(remotePath, ['clone', '.', other])
  writeFileSync(join(other, 'claude', 'CLAUDE.md'), 'theirs\n')
  git(other, ['config', 'user.email', 'o@o']); git(other, ['config', 'user.name', 'o'])
  git(other, ['add', '-A']); git(other, ['commit', '-q', '-m', 'theirs'])
  git(other, ['push', '-q'])

  // Fetch to know about remote's new commit
  git(repoPath, ['fetch', '-q'])

  // Source has mine
  writeFileSync(join(claudePath, 'CLAUDE.md'), 'mine\n')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Resolver', () => {
  it('computes base/mine/theirs for diverged path', async () => {
    const state = await computeResolverState({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, userDataDir,
    })
    expect(state.files).toHaveLength(1)
    const f = state.files[0]!
    expect(f.repoPath).toBe('claude/CLAUDE.md')
    expect(f.base?.toString('utf8')).toBe('base\n')
    expect(f.mine?.toString('utf8')).toBe('mine\n')
    expect(f.theirs?.toString('utf8')).toBe('theirs\n')
  })

  it('persists and reloads state', async () => {
    const state = await computeResolverState({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, userDataDir,
    })
    state.files[0]!.choice = 'mine'
    persistResolverState(userDataDir, state)
    const loaded = loadResolverState(userDataDir)
    expect(loaded?.files[0]?.choice).toBe('mine')
    clearResolverState(userDataDir)
    expect(loadResolverState(userDataDir)).toBeNull()
  })

  it('apply with choice=mine writes mine to source and pushes 2-parent commit', async () => {
    const state = await computeResolverState({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, userDataDir,
    })
    state.files[0]!.choice = 'mine'
    const r = await executeResolve({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, userDataDir,
      commitMessage: 'merge mine', resolutions: state,
    })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('mine\n')
    // verify remote got a 2-parent commit on main
    const log = spawnSync('git', ['--git-dir', remotePath, 'log', '--pretty=%P', '-n', '1', 'main'], { encoding: 'utf8' })
    expect(log.stdout.trim().split(' ')).toHaveLength(2)
  })

  it('manual choice without editedContent returns validation error and does not modify source', async () => {
    const state = await computeResolverState({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, userDataDir,
    })
    // Preserve source content before resolution
    const filePath = join(claudePath, 'CLAUDE.md')
    const contentBefore = readFileSync(filePath)

    // Get HEAD SHA before
    const headBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' })
    const headShaBefore = headBefore.stdout.trim()

    // Set choice to manual but do NOT set editedContent
    state.files[0]!.choice = 'manual'
    // editedContent is undefined, which is what we want to test

    const r = await executeResolve({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, userDataDir,
      commitMessage: 'attempt manual without content', resolutions: state,
    })

    // Expect validation error
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/manual/i)

    // Verify source was not modified
    const contentAfter = readFileSync(filePath)
    expect(contentAfter).toEqual(contentBefore)

    // Verify HEAD did not move
    const headAfter = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8' })
    const headShaAfter = headAfter.stdout.trim()
    expect(headShaAfter).toBe(headShaBefore)
  })
})
