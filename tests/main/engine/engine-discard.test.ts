import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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
  git(repoPath, ['config', 'core.autocrlf', 'false'])
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'committed\n')
  git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'init'])
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('executeDiscard', () => {
  it('overwrites source with HEAD content', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'local mess\n')
    const r = await executeDiscard({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true } })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'CLAUDE.md'), 'utf8')).toBe('committed\n')
    const status = await refreshStatus({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true }, doFetch: false })
    expect(status.localChanges).toBe(0)
  })
})

describe('executeDiscard — added handling', () => {
  const SG = { claudeMd: true, commands: true, skills: true, settings: true }
  // A genuinely-tracked added file (commands/ is a synced path) shows as 'added'
  // in the diff. An untracked service file would never appear in diffs and must
  // never be touched by discard.
  it('keeps local-only added files by default', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'committed\n')
    mkdirSync(join(claudePath, 'commands'))
    writeFileSync(join(claudePath, 'commands', 'new-note.md'), 'brand new\n')
    const r = await executeDiscard({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: SG })
    expect(r.kind).toBe('ok')
    expect(readFileSync(join(claudePath, 'commands', 'new-note.md'), 'utf8')).toBe('brand new\n')
  })
  it('deletes added files when deleteAdded=true', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'committed\n')
    mkdirSync(join(claudePath, 'commands'))
    writeFileSync(join(claudePath, 'commands', 'new-note.md'), 'brand new\n')
    const r = await executeDiscard({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: SG, deleteAdded: true })
    expect(r.kind).toBe('ok')
    expect(existsSync(join(claudePath, 'commands', 'new-note.md'))).toBe(false)
  })
  it('never deletes untracked service files even when deleteAdded=true', async () => {
    // .credentials.json, sessions/, history.jsonl etc. are ignored by sync
    // rules → not in diffs → discard must leave them alone.
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'committed\n')
    writeFileSync(join(claudePath, '.credentials.json'), 'SECRET')
    mkdirSync(join(claudePath, 'sessions'))
    writeFileSync(join(claudePath, 'sessions', 's.jsonl'), 'session-data')
    const r = await executeDiscard({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: SG, deleteAdded: true })
    expect(r.kind).toBe('ok')
    expect(existsSync(join(claudePath, '.credentials.json'))).toBe(true)
    expect(existsSync(join(claudePath, 'sessions', 's.jsonl'))).toBe(true)
  })
})
