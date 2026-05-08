import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runCommandMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/runner', () => ({
  runCommand: runCommandMock,
  withRunLock: <T,>(task: () => Promise<T>) => task(),
}))

const loadTokenMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/safe-storage', () => ({
  loadToken: loadTokenMock,
}))

import {
  exportRulesToRepo,
  stripSecretsInRepo,
  detectInstallMode,
} from '../../src/main/push'

let dir: string
let rulesTarget: string
let repoPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-push-'))
  rulesTarget = join(dir, 'claude')
  repoPath = join(dir, 'repo')
  mkdirSync(rulesTarget)
  mkdirSync(join(repoPath, 'global'), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('exportRulesToRepo', () => {
  it('mirrors CLAUDE.md from rulesTarget to global/CLAUDE.md', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'updated rules')
    exportRulesToRepo(rulesTarget, repoPath)
    expect(readFileSync(join(repoPath, 'global', 'CLAUDE.md'), 'utf8')).toBe('updated rules')
  })

  it('mirrors settings.json with env preserved (strip happens later)', () => {
    writeFileSync(join(rulesTarget, 'settings.json'), '{"env":{"K":"v"},"x":1}')
    exportRulesToRepo(rulesTarget, repoPath)
    const out = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(out.env).toEqual({ K: 'v' })
  })

  it('mirrors commands directory and removes deleted entries', () => {
    mkdirSync(join(rulesTarget, 'commands'))
    writeFileSync(join(rulesTarget, 'commands', 'a.md'), 'A')
    mkdirSync(join(repoPath, 'global', 'commands'))
    writeFileSync(join(repoPath, 'global', 'commands', 'old.md'), 'OLD')

    exportRulesToRepo(rulesTarget, repoPath)
    expect(readFileSync(join(repoPath, 'global', 'commands', 'a.md'), 'utf8')).toBe('A')
    expect(existsSync(join(repoPath, 'global', 'commands', 'old.md'))).toBe(false)
  })

  it('mirrors skills/<dir>/ recursively', () => {
    mkdirSync(join(rulesTarget, 'skills', 's1'), { recursive: true })
    writeFileSync(join(rulesTarget, 'skills', 's1', 'SKILL.md'), 'X')
    exportRulesToRepo(rulesTarget, repoPath)
    expect(readFileSync(join(repoPath, 'global', 'skills', 's1', 'SKILL.md'), 'utf8')).toBe('X')
  })

  it('mirrors only memory subdirs from projects/, ignores sessions and *.jsonl', () => {
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'memory', 'm.md'), 'M')
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'session.jsonl'), 's')

    exportRulesToRepo(rulesTarget, repoPath)
    expect(
      readFileSync(join(repoPath, 'global', 'projects', '-p1', 'memory', 'm.md'), 'utf8'),
    ).toBe('M')
    expect(existsSync(join(repoPath, 'global', 'projects', '-p1', 'session.jsonl'))).toBe(false)
  })

  it('removes orphan project memory entries when source no longer has them', () => {
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'memory', 'new.md'), 'NEW')
    mkdirSync(join(repoPath, 'global', 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(repoPath, 'global', 'projects', '-p1', 'memory', 'old.md'), 'OLD')

    exportRulesToRepo(rulesTarget, repoPath)
    expect(existsSync(join(repoPath, 'global', 'projects', '-p1', 'memory', 'new.md'))).toBe(true)
    expect(existsSync(join(repoPath, 'global', 'projects', '-p1', 'memory', 'old.md'))).toBe(false)
  })
})

describe('stripSecretsInRepo', () => {
  it('removes env block from global/settings.json', () => {
    writeFileSync(
      join(repoPath, 'global', 'settings.json'),
      JSON.stringify({ env: { K: 'v' }, x: 1 }),
    )
    stripSecretsInRepo(repoPath)
    const out = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(out.env).toBeUndefined()
    expect(out.x).toBe(1)
  })

  it('is a no-op when settings.json missing', () => {
    expect(() => stripSecretsInRepo(repoPath)).not.toThrow()
  })

  it('throws on invalid JSON', () => {
    writeFileSync(join(repoPath, 'global', 'settings.json'), '{not json')
    expect(() => stripSecretsInRepo(repoPath)).toThrow(/invalid/i)
  })

  it('preserves settings.json when no env block present', () => {
    writeFileSync(join(repoPath, 'global', 'settings.json'), JSON.stringify({ x: 1 }))
    stripSecretsInRepo(repoPath)
    const out = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(out).toEqual({ x: 1 })
  })
})

describe('detectInstallMode', () => {
  it('returns symlink when probe is symlink', () => {
    if (process.platform === 'win32') return // skip on Win — symlink test needs admin
    const target = join(repoPath, 'global', 'CLAUDE.md')
    writeFileSync(target, 'rules')
    symlinkSync(target, join(rulesTarget, 'CLAUDE.md'))
    expect(detectInstallMode(rulesTarget, repoPath)).toBe('symlink')
  })

  it('returns copy when probe is regular file', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'rules')
    writeFileSync(join(repoPath, 'global', 'CLAUDE.md'), 'rules')
    expect(detectInstallMode(rulesTarget, repoPath)).toBe('copy')
  })

  it('returns copy when probe missing in rulesTarget', () => {
    expect(detectInstallMode(rulesTarget, repoPath)).toBe('copy')
  })
})

import { runPush, getRepoStatus } from '../../src/main/push'

describe('runPush', () => {
  beforeEach(() => {
    runCommandMock.mockReset()
    loadTokenMock.mockReset()

    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        repoUrl: 'https://github.com/me/r.git',
        repoPath,
        rulesTarget,
        includeSecretsInPush: false,
      }),
    )
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'rules')
  })

  it('fails when no token', async () => {
    loadTokenMock.mockReturnValue(null)
    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/sign|auth/i)
  })

  it('fails when sync not configured', async () => {
    loadTokenMock.mockReturnValue('tok')
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        repoPath: null,
        repoUrl: null,
        rulesTarget: null,
        includeSecretsInPush: false,
      }),
    )
    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not configured/i)
  })

  it('returns nothing-to-push when status clean', async () => {
    loadTokenMock.mockReturnValue('tok')
    runCommandMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(true)
    expect(r.error).toMatch(/nothing/i)
  })

  it('happy path: export → status dirty → rebase → commit → push', async () => {
    loadTokenMock.mockReturnValue('tok')
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: ' M global/CLAUDE.md\n', stderr: '' }) // status
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // pull --rebase
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // add
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // commit
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // push

    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'updated')

    const steps: string[] = []
    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'updated',
      emit: () => {},
      emitStep: (e) => steps.push(`${e.step}:${e.status}`),
    })
    expect(r.ok).toBe(true)
    expect(steps).toContain('export:done')
    expect(steps).toContain('pull:done')
    expect(steps).toContain('commit:done')
    expect(steps).toContain('push:done')
  })

  it('aborts on rebase conflict', async () => {
    loadTokenMock.mockReturnValue('tok')
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: ' M file', stderr: '' }) // status (dirty)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'CONFLICT' }) // pull --rebase fails
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // rebase --abort

    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/conflict|resolve/i)
  })

  it('strips secrets when includeSecrets=false', async () => {
    loadTokenMock.mockReturnValue('tok')
    writeFileSync(
      join(rulesTarget, 'settings.json'),
      JSON.stringify({ env: { K: 'v' }, x: 1 }),
    )
    runCommandMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })

    const out = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(out.env).toBeUndefined()
    expect(out.x).toBe(1)
  })

  it('keeps secrets when includeSecrets=true', async () => {
    loadTokenMock.mockReturnValue('tok')
    writeFileSync(
      join(rulesTarget, 'settings.json'),
      JSON.stringify({ env: { K: 'v' }, x: 1 }),
    )
    runCommandMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: true,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })

    const out = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(out.env).toEqual({ K: 'v' })
  })
})

describe('getRepoStatus', () => {
  beforeEach(() => runCommandMock.mockReset())

  it('returns clean=true when no changes', async () => {
    runCommandMock.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
    const r = await getRepoStatus(repoPath)
    expect(r.clean).toBe(true)
    expect(r.changedFiles).toEqual([])
  })

  it('parses changed files', async () => {
    runCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: ' M global/CLAUDE.md\n?? global/skills/new/\n',
      stderr: '',
    })
    const r = await getRepoStatus(repoPath)
    expect(r.clean).toBe(false)
    expect(r.changedFiles).toContain('global/CLAUDE.md')
    expect(r.changedFiles).toContain('global/skills/new/')
  })
})
