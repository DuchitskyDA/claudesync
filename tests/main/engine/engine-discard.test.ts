import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { executeDiscard, refreshStatus } from '../../../src/main/sync/engine/engine'

let dir: string, claudePath: string, repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-dsc-'))
  claudePath = join(dir, '.claude'); mkdirSync(claudePath)
  repoPath = join(dir, 'repo'); mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'committed\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'init'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('executeDiscard', () => {
  it('overwrites source with HEAD content', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'local mess\n')
    const r = await executeDiscard({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('committed\n')
    const status = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null, doFetch: false })
    expect(status.localChanges).toBe(0)
  })
})
