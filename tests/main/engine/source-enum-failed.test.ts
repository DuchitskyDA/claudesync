import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const failSet = vi.hoisted(() => ({ dirs: new Set<string>() }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readdirSync: ((p: unknown, ...rest: unknown[]) => {
      if (failSet.dirs.has(String(p))) {
        const e = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
        e.code = 'EPERM'
        throw e
      }
      return (actual.readdirSync as (...a: unknown[]) => unknown)(p, ...rest)
    }) as typeof actual.readdirSync,
  }
})

import { enumClaudeSource, repoPathUnderFailed } from '../../../src/main/sync/engine/source-enum'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cse-failed-')); failSet.dirs.clear() })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('walk failures → failed prefixes (К2)', () => {
  it('unreadable subdirectory lands in failed, not silently dropped', async () => {
    const home = join(root, '.claude')
    mkdirSync(join(home, 'commands'), { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), 'x')
    writeFileSync(join(home, 'commands', 'a.md'), 'a')
    failSet.dirs.add(join(home, 'commands'))

    const res = await enumClaudeSource(home, [], allOn)
    expect(res.entries.map((e) => e.repoPath)).toEqual(['claude/CLAUDE.md'])
    expect(res.failed).toContain('claude/commands')
  })

  it('whole root unreadable → failed covers everything', async () => {
    const home = join(root, '.claude')
    mkdirSync(home, { recursive: true })
    failSet.dirs.add(home)
    const res = await enumClaudeSource(home, [], allOn)
    expect(res.entries).toEqual([])
    expect(res.failed).toEqual(['claude/'])
  })
})

describe('repoPathUnderFailed', () => {
  it('matches exact path and prefix', () => {
    expect(repoPathUnderFailed('claude/commands/a.md', ['claude/commands'])).toBe(true)
    expect(repoPathUnderFailed('claude/commands', ['claude/commands'])).toBe(true)
    expect(repoPathUnderFailed('claude/commandsX/a.md', ['claude/commands'])).toBe(false)
    expect(repoPathUnderFailed('claude/anything', ['claude/'])).toBe(true)
    expect(repoPathUnderFailed('claude/anything', [])).toBe(false)
  })
})

import { refreshStatus } from '../../../src/main/sync/engine/engine'
import { initEmptyRepo } from '../../fixtures/sync-roundtrip'
import { spawnSync } from 'node:child_process'

describe('walk failures → failed prefixes (К2)', () => {
  it('refreshStatus: HEAD files under failed dir are unreadable, not deleted', async () => {
    const repoPath = join(root, 'repo')
    initEmptyRepo(repoPath)
    const home = join(root, '.claude')
    mkdirSync(join(home, 'commands'), { recursive: true })
    writeFileSync(join(home, 'commands', 'a.md'), 'a')
    mkdirSync(join(repoPath, 'claude', 'commands'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'commands', 'a.md'), 'a')
    spawnSync('git', ['-C', repoPath, 'add', '-A'], { encoding: 'utf8' })
    spawnSync('git', ['-C', repoPath, 'commit', '-m', 'seed'], { encoding: 'utf8' })
    failSet.dirs.add(join(home, 'commands'))

    const status = await refreshStatus({
      repoPath, claudePath: home, claudeProjects: [], cursorProjects: [],
      token: null, doFetch: false, syncGlobal: allOn,
    })
    const entry = status.diffs.find((d) => d.repoPath === 'claude/commands/a.md')
    expect(entry?.status).toBe('unreadable')
    expect(status.localChanges).toBe(0)
  })
})
