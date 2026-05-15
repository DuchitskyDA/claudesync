import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { refreshStatus } from '../../../src/main/sync/engine/engine'
import type { CursorProject } from '@shared/api'

let dir: string
let claudePath: string
let repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-eng-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath)
  mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t'])
  git(repoPath, ['config', 'user.name', 't'])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'hello\n')
  git(repoPath, ['add', '-A'])
  git(repoPath, ['commit', '-q', '-m', 'init'])
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('refreshStatus', () => {
  it('reports in-sync when source matches HEAD exactly', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello\n')
    const s = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(s.state).toBe('in-sync')
    expect(s.localChanges).toBe(0)
  })
  it('reports local-changes when source has new file', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"theme":"dark"}')
    const s = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(s.state).toBe('local-changes')
    expect(s.localChanges).toBe(1)
    const added = s.diffs.find((d) => d.repoPath === 'claude/settings.json')
    expect(added?.status).toBe('added')
  })
  it('ignores Claude volatile keys in settings.json', async () => {
    // Write settings to HEAD then bump only numStartups in source — should report in-sync.
    writeFileSync(join(repoPath, 'claude', 'settings.json'), '{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-q', '-m', 'settings'])
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hello\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"permissions":{"allow":["x"]},"numStartups":42}')
    const s = await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    expect(s.state).toBe('in-sync')
    expect(s.localChanges).toBe(0)
  })
  it('does NOT write to WT (no phantom diff)', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'modified\n')
    await refreshStatus({ repoPath, claudePath, cursorProjects: [], token: null })
    const wtContent = require('node:fs').readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')
    expect(wtContent).toBe('hello\n')  // WT untouched
  })
})
