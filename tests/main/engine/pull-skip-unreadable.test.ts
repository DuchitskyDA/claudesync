import { it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computePullPreview, executePullApply } from '../../../src/main/sync/engine/engine'
import { initEmptyRepo } from '../../fixtures/sync-roundtrip'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-skip-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function git(repo: string, args: string[]): void {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

it('pull skips locally-unparseable settings.json, preserves env, applies the rest', async () => {
  const repoPath = join(root, 'repo')
  initEmptyRepo(repoPath)
  const home = join(root, '.claude')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(repoPath, 'claude'), { recursive: true })
  writeFileSync(join(repoPath, 'claude', 'settings.json'), JSON.stringify({ theme: 'dark' }, null, 2))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v1\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-m', 'seed'])
  const bare = join(root, 'origin.git')
  git(repoPath, ['clone', '--bare', repoPath, bare])
  git(repoPath, ['remote', 'add', 'origin', bare])
  writeFileSync(join(repoPath, 'claude', 'settings.json'), JSON.stringify({ theme: 'light' }, null, 2))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'v2\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-m', 'remote'])
  git(repoPath, ['push', 'origin', 'main']); git(repoPath, ['reset', '--hard', 'HEAD~1'])
  writeFileSync(join(home, 'CLAUDE.md'), 'v1\n')
  const broken = '{ "theme": "dark", "env": { "API_KEY": "sec' // truncated json mid-edit
  writeFileSync(join(home, 'settings.json'), broken)

  // NB: после Task 8 в args добавится userDataDir (Task 8, Step 8)
  const args = {
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, syncGlobal: allOn, deletionsToApply: [] as string[],
  }
  const preview = await computePullPreview(args)
  expect(preview.kind).toBe('preview')
  if (preview.kind !== 'preview') return
  const settingsItem = preview.items.find((i) => i.repoPath === 'claude/settings.json')
  expect(settingsItem?.status).toBe('skipped-unreadable')

  const r = await executePullApply(args)
  expect(r.kind).toBe('ok')
  expect(readFileSync(join(home, 'settings.json'), 'utf8')).toBe(broken)
  expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe('v2\n')
  const head = spawnSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  const remote = spawnSync('git', ['-C', repoPath, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).stdout.trim()
  expect(head).toBe(remote)
})
