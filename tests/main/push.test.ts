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
  mkdirSync(join(repoPath, 'claude'), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('exportRulesToRepo', () => {
  it('mirrors CLAUDE.md from rulesTarget to global/CLAUDE.md', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'updated rules')
    exportRulesToRepo(rulesTarget, repoPath)
    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('updated rules')
  })

  it('mirrors settings.json with env preserved (strip happens later)', () => {
    writeFileSync(join(rulesTarget, 'settings.json'), '{"env":{"K":"v"},"x":1}')
    exportRulesToRepo(rulesTarget, repoPath)
    const out = JSON.parse(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8'))
    expect(out.env).toEqual({ K: 'v' })
  })

  it('mirrors commands directory and removes deleted entries', () => {
    mkdirSync(join(rulesTarget, 'commands'))
    writeFileSync(join(rulesTarget, 'commands', 'a.md'), 'A')
    mkdirSync(join(repoPath, 'claude', 'commands'))
    writeFileSync(join(repoPath, 'claude', 'commands', 'old.md'), 'OLD')

    exportRulesToRepo(rulesTarget, repoPath)
    expect(readFileSync(join(repoPath, 'claude', 'commands', 'a.md'), 'utf8')).toBe('A')
    expect(existsSync(join(repoPath, 'claude', 'commands', 'old.md'))).toBe(false)
  })

  it('mirrors skills/<dir>/ recursively', () => {
    mkdirSync(join(rulesTarget, 'skills', 's1'), { recursive: true })
    writeFileSync(join(rulesTarget, 'skills', 's1', 'SKILL.md'), 'X')
    exportRulesToRepo(rulesTarget, repoPath)
    expect(readFileSync(join(repoPath, 'claude', 'skills', 's1', 'SKILL.md'), 'utf8')).toBe('X')
  })

  it('mirrors only memory subdirs from projects/, ignores sessions and *.jsonl', () => {
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'memory', 'm.md'), 'M')
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'session.jsonl'), 's')

    exportRulesToRepo(rulesTarget, repoPath)
    expect(
      readFileSync(join(repoPath, 'claude', 'projects', '-p1', 'memory', 'm.md'), 'utf8'),
    ).toBe('M')
    expect(existsSync(join(repoPath, 'claude', 'projects', '-p1', 'session.jsonl'))).toBe(false)
  })

  it('skips .backup.<ts> artifacts in src and removes them from dst', () => {
    mkdirSync(join(rulesTarget, 'commands'))
    writeFileSync(join(rulesTarget, 'commands', 'a.md'), 'A')
    writeFileSync(join(rulesTarget, 'commands', 'a.md.backup.20260506-105039'), 'OLD-A')
    mkdirSync(join(rulesTarget, 'skills', 'foo.backup.20260508-152134'), { recursive: true })
    writeFileSync(join(rulesTarget, 'skills', 'foo.backup.20260508-152134', 'SKILL.md'), 'JUNK')

    // Pre-populate dst with a stale backup that we should also clean up
    mkdirSync(join(repoPath, 'claude', 'commands'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'commands', 'b.md.backup.20260101-000000'), 'STALE')

    exportRulesToRepo(rulesTarget, repoPath)

    expect(readFileSync(join(repoPath, 'claude', 'commands', 'a.md'), 'utf8')).toBe('A')
    expect(existsSync(join(repoPath, 'claude', 'commands', 'a.md.backup.20260506-105039'))).toBe(false)
    expect(existsSync(join(repoPath, 'claude', 'skills', 'foo.backup.20260508-152134'))).toBe(false)
    expect(existsSync(join(repoPath, 'claude', 'commands', 'b.md.backup.20260101-000000'))).toBe(false)
  })

  it('removes orphan project memory entries when source no longer has them', () => {
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'memory', 'new.md'), 'NEW')
    mkdirSync(join(repoPath, 'claude', 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'projects', '-p1', 'memory', 'old.md'), 'OLD')

    exportRulesToRepo(rulesTarget, repoPath)
    expect(existsSync(join(repoPath, 'claude', 'projects', '-p1', 'memory', 'new.md'))).toBe(true)
    expect(existsSync(join(repoPath, 'claude', 'projects', '-p1', 'memory', 'old.md'))).toBe(false)
  })
})

describe('stripSecretsInRepo', () => {
  it('removes env block from global/settings.json', () => {
    writeFileSync(
      join(repoPath, 'claude', 'settings.json'),
      JSON.stringify({ env: { K: 'v' }, x: 1 }),
    )
    stripSecretsInRepo(repoPath)
    const out = JSON.parse(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8'))
    expect(out.env).toBeUndefined()
    expect(out.x).toBe(1)
  })

  it('is a no-op when settings.json missing', () => {
    expect(() => stripSecretsInRepo(repoPath)).not.toThrow()
  })

  it('throws on invalid JSON', () => {
    writeFileSync(join(repoPath, 'claude', 'settings.json'), '{not json')
    expect(() => stripSecretsInRepo(repoPath)).toThrow(/invalid/i)
  })

  it('preserves settings.json when no env block present', () => {
    writeFileSync(join(repoPath, 'claude', 'settings.json'), JSON.stringify({ x: 1 }))
    stripSecretsInRepo(repoPath)
    const out = JSON.parse(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8'))
    expect(out).toEqual({ x: 1 })
  })
})

describe('detectInstallMode', () => {
  it('returns symlink when probe is symlink', () => {
    if (process.platform === 'win32') return // skip on Win — symlink test needs admin
    const target = join(repoPath, 'claude', 'CLAUDE.md')
    writeFileSync(target, 'rules')
    symlinkSync(target, join(rulesTarget, 'CLAUDE.md'))
    expect(detectInstallMode(rulesTarget)).toBe('symlink')
  })

  it('returns copy when probe is regular file', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'rules')
    writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'rules')
    expect(detectInstallMode(rulesTarget)).toBe('copy')
  })

  it('returns copy when probe missing in rulesTarget', () => {
    expect(detectInstallMode(rulesTarget)).toBe('copy')
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
    expect((r.error as { key: string }).key).toBe('push.error.notSignedIn')
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
    expect((r.error as { key: string }).key).toBe('push.error.notConfigured')
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
    expect((r.error as { key: string }).key).toBe('push.info.nothingToPush')
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

  it('returns conflict kind without aborting on rebase conflict', async () => {
    loadTokenMock.mockReturnValue('tok')
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: ' M file', stderr: '' }) // status (dirty)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in foo' }) // pull --rebase fails

    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(false)
    expect((r.error as { key: string }).key).toBe('push.error.conflict')
    expect(r.kind).toBe('conflict')

    // Ensure rebase --abort was NOT called — rebase must stay paused for the resolver UI
    const abortCalled = vi.mocked(runCommandMock).mock.calls.some(
      (args) => Array.isArray(args[1]) && args[1].includes('--abort'),
    )
    expect(abortCalled).toBe(false)
  })

  it('retries pull once on TLS error and succeeds', async () => {
    loadTokenMock.mockReturnValue('tok')
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: ' M file', stderr: '' }) // status
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: unable to access ...: TLS connect error: SSL routines::unexpected eof',
      }) // pull #1 (TLS)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // rebase --abort
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // pull #2 (retry OK)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // add
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // commit
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // push

    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'updated')

    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(true)
  })

  it('reports network error after retry also fails', async () => {
    loadTokenMock.mockReturnValue('tok')
    const tls = {
      exitCode: 1,
      stdout: '',
      stderr: 'fatal: unable to access ...: TLS connect error: SSL routines::unexpected eof',
    }
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: ' M file', stderr: '' }) // status
      .mockResolvedValueOnce(tls) // pull #1
      .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'no rebase in progress' }) // abort #1
      .mockResolvedValueOnce(tls) // pull #2 (retry fails too)
      .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'no rebase in progress' }) // abort #2

    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(false)
    expect((r.error as { key: string }).key).toBe('push.error.network')
  })

  it('classifies auth failure distinctly', async () => {
    loadTokenMock.mockReturnValue('tok')
    runCommandMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: ' M file', stderr: '' })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: Authentication failed for https://github.com/me/r.git/',
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })

    const r = await runPush({
      configPath: join(dir, 'config.json'),
      userDataDir: dir,
      includeSecrets: false,
      commitMessage: 'msg',
      emit: () => {},
      emitStep: () => {},
    })
    expect(r.ok).toBe(false)
    expect((r.error as { key: string }).key).toBe('push.error.auth')
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

    const out = JSON.parse(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8'))
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

    const out = JSON.parse(readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8'))
    expect(out.env).toEqual({ K: 'v' })
  })
})

describe('classifyPullError', () => {
  it('detects TLS as network', async () => {
    const { classifyPullError } = await import('../../src/main/push')
    expect(classifyPullError('fatal: unable to access: TLS connect error')).toBe('network')
    expect(classifyPullError('SSL routines::unexpected eof while reading')).toBe('network')
    expect(classifyPullError('Could not resolve host: github.com')).toBe('network')
    expect(classifyPullError('Connection reset by peer')).toBe('network')
  })

  it('detects auth failures', async () => {
    const { classifyPullError } = await import('../../src/main/push')
    expect(classifyPullError('fatal: Authentication failed')).toBe('auth')
    expect(classifyPullError('remote: Bad credentials')).toBe('auth')
    expect(classifyPullError('error: 403 Forbidden')).toBe('auth')
  })

  it('detects merge conflicts', async () => {
    const { classifyPullError } = await import('../../src/main/push')
    expect(classifyPullError('CONFLICT (content): Merge conflict in foo')).toBe('conflict')
    expect(classifyPullError('Automatic merge failed')).toBe('conflict')
  })

  it('falls through to other for unknown', async () => {
    const { classifyPullError } = await import('../../src/main/push')
    expect(classifyPullError('some unknown error')).toBe('other')
    expect(classifyPullError('')).toBe('other')
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
      stdout: ' M claude/CLAUDE.md\n?? claude/skills/new/\n',
      stderr: '',
    })
    const r = await getRepoStatus(repoPath)
    expect(r.clean).toBe(false)
    expect(r.changedFiles).toContain('claude/CLAUDE.md')
    expect(r.changedFiles).toContain('claude/skills/new/')
  })
})
