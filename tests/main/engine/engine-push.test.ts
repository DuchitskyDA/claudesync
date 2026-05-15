import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computePushPreview, executePush } from '../../../src/main/sync/engine/engine'

let dir: string, claudePath: string, repoPath: string, remotePath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-push-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  remotePath = join(dir, 'remote.git')
  mkdirSync(claudePath); mkdirSync(repoPath); mkdirSync(remotePath)
  git(remotePath, ['init', '--bare', '-q', '-b', 'main'])
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'core.autocrlf', 'false'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  git(repoPath, ['remote', 'add', 'origin', remotePath])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'old\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'init'])
  git(repoPath, ['push', '-q', '-u', 'origin', 'main'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Engine.push', () => {
  it('preview lists modified files; execute commits and pushes; WT == HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'new\n')
    const preview = await computePushPreview({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(preview.kind).toBe('preview')
    if (preview.kind !== 'preview') throw new Error('expected preview')
    expect(preview.items.find((d) => d.repoPath === 'claude/CLAUDE.md')?.status).toBe('modified')

    const result = await executePush({
      repoPath, claudePath, cursorProjects: [], token: null,
      commitMessage: 'update CLAUDE.md',
    })
    expect(result.kind).toBe('ok')
    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('new\n')

    // Remote received it
    const lsR = spawnSync('git', ['--git-dir', remotePath, 'cat-file', '-p', 'main:claude/CLAUDE.md'], { encoding: 'utf8' })
    expect(lsR.stdout).toBe('new\n')
  })

  it('returns nothing-to-push when source matches HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')
    const r = await executePush({ repoPath, claudePath, cursorProjects: [], token: null, commitMessage: 'noop' })
    expect(r.kind).toBe('nothing-to-push')
  })

  it('blocks when diverged', async () => {
    // Push from a parallel clone to advance remote
    const other = join(dir, 'other')
    git(remotePath, ['clone', '.', other])
    writeFileSync(join(other, 'claude', 'CLAUDE.md'), 'remote-change\n')
    git(other, ['config', 'user.email', 't@t']); git(other, ['config', 'user.name', 't'])
    git(other, ['commit', '-am', 'remote'])
    git(other, ['push', '-q'])

    // Local has its own change
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'local-change\n')
    const p = await computePushPreview({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(p.kind).toBe('diverged')
  })
})
