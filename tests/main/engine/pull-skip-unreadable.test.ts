import { it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

function setupAheadRepo(): { repoPath: string; home: string } {
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
  return { repoPath, home }
}

it('pull skips locally-unparseable settings.json, preserves env, applies the rest', async () => {
  const { repoPath, home } = setupAheadRepo()
  writeFileSync(join(home, 'CLAUDE.md'), 'v1\n')
  const broken = '{ "theme": "dark", "env": { "API_KEY": "sec' // truncated json mid-edit
  writeFileSync(join(home, 'settings.json'), broken)

  const args = {
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, syncGlobal: allOn, deletionsToApply: [] as string[],
    userDataDir: join(root, 'ud'),
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

it('executePullApply preserves overwritten files in a snapshot session', async () => {
  const { repoPath, home } = setupAheadRepo()
  // local CLAUDE.md == v1 (matches HEAD), settings.json is valid
  writeFileSync(join(home, 'CLAUDE.md'), 'v1\n')
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ theme: 'dark' }, null, 2))
  const ud = join(root, 'ud2')
  const args = {
    repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
    token: null, syncGlobal: allOn, deletionsToApply: [] as string[], userDataDir: ud,
  }
  const r = await executePullApply(args)
  expect(r.kind).toBe('ok')
  const sessions = readdirSync(join(ud, 'safety-snapshots'))
  expect(sessions).toHaveLength(1)
  const manifest = JSON.parse(readFileSync(
    join(ud, 'safety-snapshots', sessions[0]!, 'manifest.json'), 'utf8'))
  expect(manifest.entries.map((e: { original: string }) => e.original)).toContain(join(home, 'CLAUDE.md'))
  expect(readFileSync(manifest.entries[0].stored, 'utf8')).toBe('v1\n')
})
