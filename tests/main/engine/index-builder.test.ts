import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildAndCommitFromSource } from '../../../src/main/sync/engine/index-builder'
import type { DiffEntry } from '@shared/sync-types'

let dir: string, claudePath: string, repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-ix-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath); mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t']); git(repoPath, ['config', 'user.name', 't'])
  git(repoPath, ['config', 'core.autocrlf', 'false'])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'old\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'init'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('buildAndCommitFromSource', () => {
  it('commits added/modified/deleted; WT == HEAD after', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'new\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    const diffs: DiffEntry[] = [
      { source: { kind: 'claude-global' }, repoPath: 'claude/CLAUDE.md', surfacePath: 'CLAUDE.md', status: 'modified' },
      { source: { kind: 'claude-global' }, repoPath: 'claude/settings.json', surfacePath: 'settings.json', status: 'added' },
    ]
    const sourceContent = (d: DiffEntry): Buffer | null => {
      if (d.repoPath === 'claude/CLAUDE.md') return Buffer.from('new\n', 'utf8')
      if (d.repoPath === 'claude/settings.json') return Buffer.from('{\n  "theme": "dark"\n}', 'utf8')
      return null
    }
    const newSha = await buildAndCommitFromSource({
      repoPath, diffs, sourceContent, commitMessage: 'test',
      indexFile: join(repoPath, '.git', 'tmp-index'),
    })
    expect(newSha).toMatch(/^[0-9a-f]{40}$/)
    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('new\n')
    expect(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8')).toBe('{\n  "theme": "dark"\n}')
  })
})
