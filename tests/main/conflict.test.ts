import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { getConflictState, getStageContent, isFileBinary, resolveFile, continueRebase, abortRebase, STAGE_BASE, STAGE_REMOTE, STAGE_MINE } from '../../src/main/conflict'

let dir: string
let repo: string

function git(args: string, cwd: string = repo): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8' }).toString().trim()
}

function setupConflictedRepo(): void {
  git('init -q -b main')
  git('config user.email t@e.com')
  git('config user.name t')
  git('config commit.gpgsign false')
  // Initial common commit
  writeFileSync(join(repo, 'CLAUDE.md'), 'shared line\n')
  git('add CLAUDE.md')
  git('commit -q -m base')
  // 'remote' branch with its own change
  git('checkout -q -b remote-branch')
  writeFileSync(join(repo, 'CLAUDE.md'), 'remote line\n')
  git('commit -q -am "remote change"')
  // back to main with a different change
  git('checkout -q main')
  writeFileSync(join(repo, 'CLAUDE.md'), 'mine line\n')
  git('commit -q -am "mine change"')
  // Rebase main onto remote-branch — generates conflict
  try {
    git('rebase remote-branch')
  } catch {
    // expected — conflict
  }
  if (
    !existsSync(join(repo, '.git', 'rebase-merge')) &&
    !existsSync(join(repo, '.git', 'rebase-apply'))
  ) {
    throw new Error('Test fixture failed: expected paused rebase state after rebase')
  }
}

function setupCleanRepo(): void {
  git('init -q -b main')
  git('config user.email t@e.com')
  git('config user.name t')
  git('config commit.gpgsign false')
  writeFileSync(join(repo, 'a.txt'), 'x')
  git('add a.txt')
  git('commit -q -m init')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-conflict-'))
  repo = join(dir, 'repo')
  mkdirSync(repo)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('getConflictState', () => {
  it('returns inProgress=false on clean repo', () => {
    setupCleanRepo()
    const state = getConflictState(repo)
    expect(state.inProgress).toBe(false)
    expect(state.files).toEqual([])
  })

  it('detects paused rebase with unmerged file', () => {
    setupConflictedRepo()
    const state = getConflictState(repo)
    expect(state.inProgress).toBe(true)
    expect(state.files).toHaveLength(1)
    const file = state.files[0]
    expect(file?.path).toBe('CLAUDE.md')
    expect(file?.status).toBe('unresolved')
    expect(file?.binary).toBe(false)
  })
})

describe('getStageContent', () => {
  it('returns content of each stage during conflict', () => {
    setupConflictedRepo()
    const base = getStageContent(repo, 'CLAUDE.md', STAGE_BASE)
    const remote = getStageContent(repo, 'CLAUDE.md', STAGE_REMOTE)
    const mine = getStageContent(repo, 'CLAUDE.md', STAGE_MINE)
    expect(base.text?.trim()).toBe('shared line')
    expect(remote.text?.trim()).toBe('remote line')
    expect(mine.text?.trim()).toBe('mine line')
    expect(base.binary).toBe(false)
    expect(remote.binary).toBe(false)
    expect(mine.binary).toBe(false)
  })
})

describe('isFileBinary', () => {
  it('detects binary content via null byte heuristic', () => {
    setupCleanRepo()
    const bin = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff])
    writeFileSync(join(repo, 'data.bin'), bin)
    expect(isFileBinary(repo, 'data.bin')).toBe(true)
  })

  it('treats utf-8 text files as non-binary', () => {
    setupCleanRepo()
    writeFileSync(join(repo, 'doc.md'), 'hello world\n', 'utf8')
    expect(isFileBinary(repo, 'doc.md')).toBe(false)
  })
})

describe('resolveFile', () => {
  it("'mine' resolves to local-side content (mine line)", () => {
    setupConflictedRepo()
    const r = resolveFile(repo, 'CLAUDE.md', 'mine')
    expect(r.ok).toBe(true)
    const content = readFileSync(join(repo, 'CLAUDE.md'), 'utf8').trim()
    expect(content).toBe('mine line')
    const state = getConflictState(repo)
    expect(state.files.find((f) => f.path === 'CLAUDE.md')).toBeUndefined()
  })

  it("'remote' resolves to upstream content (remote line)", () => {
    setupConflictedRepo()
    const r = resolveFile(repo, 'CLAUDE.md', 'remote')
    expect(r.ok).toBe(true)
    const content = readFileSync(join(repo, 'CLAUDE.md'), 'utf8').trim()
    expect(content).toBe('remote line')
  })

  it("'manual' rejects when file still has conflict markers", () => {
    setupConflictedRepo()
    // Working tree has merge markers because rebase paused
    const r = resolveFile(repo, 'CLAUDE.md', 'manual')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('conflict.error.markersRemain')
  })

  it("'manual' accepts when markers removed", () => {
    setupConflictedRepo()
    writeFileSync(join(repo, 'CLAUDE.md'), 'merged manually\n')
    const r = resolveFile(repo, 'CLAUDE.md', 'manual')
    expect(r.ok).toBe(true)
    const state = getConflictState(repo)
    expect(state.files.find((f) => f.path === 'CLAUDE.md')).toBeUndefined()
  })
})

describe('continueRebase', () => {
  it('completes rebase after all files resolved', () => {
    setupConflictedRepo()
    resolveFile(repo, 'CLAUDE.md', 'mine')
    const r = continueRebase(repo)
    expect(r.ok).toBe(true)
    expect(getConflictState(repo).inProgress).toBe(false)
  })

  it('returns ok=false when files still unresolved', () => {
    setupConflictedRepo()
    const r = continueRebase(repo)
    expect(r.ok).toBe(false)
    expect(r.error?.key).toBe('conflict.error.continueFailed')
  })
})

describe('abortRebase', () => {
  it('clears paused rebase state', () => {
    setupConflictedRepo()
    expect(getConflictState(repo).inProgress).toBe(true)
    abortRebase(repo)
    expect(getConflictState(repo).inProgress).toBe(false)
  })

  it('is no-op when no rebase in progress', () => {
    setupCleanRepo()
    expect(() => abortRebase(repo)).not.toThrow()
  })
})
