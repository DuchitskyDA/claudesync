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
    const preview = await computePushPreview({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true } })
    expect(preview.kind).toBe('preview')
    if (preview.kind !== 'preview') throw new Error('expected preview')
    expect(preview.items.find((d) => d.repoPath === 'claude/CLAUDE.md')?.status).toBe('modified')

    const result = await executePush({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null,
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
      commitMessage: 'update CLAUDE.md',
      approvedDeletions: [],
    })
    expect(result.kind).toBe('ok')
    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('new\n')

    // Remote received it
    const lsR = spawnSync('git', ['--git-dir', remotePath, 'cat-file', '-p', 'main:claude/CLAUDE.md'], { encoding: 'utf8' })
    expect(lsR.stdout).toBe('new\n')
  })

  it('returns nothing-to-push when source matches HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')
    const r = await executePush({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true }, commitMessage: 'noop', approvedDeletions: [] })
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
    const p = await computePushPreview({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true } })
    expect(p.kind).toBe('diverged')
  })
})

describe('Engine.push — safeguards', () => {
  const SG = { claudeMd: true, commands: true, skills: true, settings: true }

  it('floor-blocks when a source loses >=50% of >=5 tracked files', async () => {
    mkdirSync(join(repoPath, 'claude', 'commands'), { recursive: true })
    for (let i = 0; i < 8; i++) writeFileSync(join(repoPath, 'claude', 'commands', `c${i}.md`), `v${i}\n`)
    git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'seed'])
    git(repoPath, ['push', '-q'])
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')
    const p = await computePushPreview({ repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, syncGlobal: SG })
    expect(p.kind).toBe('floor-blocked')
  })

  it('deletion is applied only when in approvedDeletions', async () => {
    mkdirSync(join(repoPath, 'claude', 'commands'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'commands', 'note.md'), 'note\n')
    git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'add note'])
    git(repoPath, ['push', '-q'])
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')

    const r1 = await executePush({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null,
      syncGlobal: SG, commitMessage: 'no-delete', approvedDeletions: [],
    })
    // The only pending change is an unapproved deletion → nothing is committed.
    expect(r1.kind).toBe('nothing-to-push')
    const after1 = spawnSync('git', ['-C', repoPath, 'cat-file', '-e', 'HEAD:claude/commands/note.md'])
    expect(after1.status).toBe(0) // note.md preserved in HEAD

    const r2 = await executePush({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null,
      syncGlobal: SG, commitMessage: 'delete note', approvedDeletions: ['claude/commands/note.md'],
    })
    expect(r2.kind).toBe('ok')
    const after2 = spawnSync('git', ['-C', repoPath, 'cat-file', '-e', 'HEAD:claude/commands/note.md'])
    expect(after2.status).not.toBe(0)
  })

  it('unreadable file keeps its HEAD version (not deleted, not changed)', async () => {
    const valid = '{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}'
    writeFileSync(join(repoPath, 'claude', 'settings.json'), valid)
    git(repoPath, ['add', '-A']); git(repoPath, ['commit', '-q', '-m', 'add settings'])
    git(repoPath, ['push', '-q'])
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'old\n')
    writeFileSync(join(claudePath, 'settings.json'), '{ broken ')
    const r = await executePush({
      repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null,
      syncGlobal: SG, commitMessage: 'noop', approvedDeletions: [],
    })
    expect(r.kind).toBe('nothing-to-push')
    const head = spawnSync('git', ['-C', repoPath, 'cat-file', '-p', 'HEAD:claude/settings.json'], { encoding: 'utf8' })
    expect(head.stdout).toBe(valid)
  })
})
