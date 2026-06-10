import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { refreshStatus, computePullPreview, executePullApply } from '../../../src/main/sync/engine/engine'
import { initEmptyRepo } from '../../fixtures/sync-roundtrip'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
let root: string

function git(repo: string, args: string[]): void {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-foreign-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function baseArgs(repoPath: string, home: string) {
  return {
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, syncGlobal: allOn,
  }
}

describe('foreign paths under claude/ (К4)', () => {
  it('refreshStatus: unknown HEAD path is foreign, not phantom-deleted', async () => {
    const repoPath = join(root, 'repo')
    initEmptyRepo(repoPath)
    const home = join(root, 'home', '.claude')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), 'rules\n')
    mkdirSync(join(repoPath, 'claude'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'rules\n')
    writeFileSync(join(repoPath, 'claude', 'unknown.txt'), 'stray\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-m', 'seed'])

    const status = await refreshStatus({ ...baseArgs(repoPath, home), doFetch: false })
    expect(status.diffs.find((d) => d.repoPath === 'claude/unknown.txt')).toBeUndefined()
    expect(status.localChanges).toBe(0)
    expect(status.foreignPaths).toContain('claude/unknown.txt')
  })

  it('pull: unknown remote path is not applied to ~/.claude and not phantom-deleted after', async () => {
    const repoPath = join(root, 'repo')
    initEmptyRepo(repoPath)
    const home = join(root, 'home', '.claude')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), 'v1\n')
    mkdirSync(join(repoPath, 'claude'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v1\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-m', 'seed'])
    const bare = join(root, 'origin.git')
    git(repoPath, ['clone', '--bare', repoPath, bare])
    git(repoPath, ['remote', 'add', 'origin', bare])
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v2\n')
    writeFileSync(join(repoPath, 'claude', 'unknown2.txt'), 'stray\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-m', 'remote change'])
    git(repoPath, ['push', 'origin', 'main'])
    git(repoPath, ['reset', '--hard', 'HEAD~1'])

    // NB: после Task 8 в args добавится userDataDir (Task 8, Step 8)
    const args = { ...baseArgs(repoPath, home), deletionsToApply: [] as string[] }
    const preview = await computePullPreview(args)
    expect(preview.kind).toBe('preview')
    if (preview.kind !== 'preview') return
    expect(preview.items.map((i) => i.repoPath)).toEqual(['claude/CLAUDE.md'])

    const r = await executePullApply(args)
    expect(r.kind).toBe('ok')
    expect(existsSync(join(home, 'unknown2.txt'))).toBe(false)
    const status = await refreshStatus({ ...baseArgs(repoPath, home), doFetch: false })
    expect(status.localChanges).toBe(0)
    expect(status.foreignPaths).toContain('claude/unknown2.txt')
  })
})
