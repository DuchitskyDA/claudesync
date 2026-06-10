import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { runCommand } from '../../src/main/runner'
import type { LogLine } from '../../src/shared/api'

function fakeProc(stdoutChunks: string[], stderrChunks: string[], exitCode: number) {
  const proc = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable }
  proc.stdout = Readable.from(stdoutChunks)
  proc.stderr = Readable.from(stderrChunks)
  setTimeout(() => proc.emit('exit', exitCode), 0)
  return proc
}

beforeEach(() => {
  spawnMock.mockReset()
})

describe('runCommand', () => {
  it('streams stdout lines as info and resolves with exit code 0', async () => {
    spawnMock.mockReturnValue(fakeProc(['hello\nworld\n'], [], 0))
    const lines: LogLine[] = []
    const result = await runCommand('echo', ['hi'], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(result.exitCode).toBe(0)
    expect(lines.map((l) => l.text)).toEqual(['hello', 'world'])
    expect(lines.every((l) => l.level === 'info')).toBe(true)
    expect(lines[0]!.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

describe('runCommand stderr and exit codes', () => {
  it('streams stderr as error level', async () => {
    spawnMock.mockReturnValue(fakeProc([], ['oops\n'], 0))
    const lines: LogLine[] = []
    await runCommand('false', [], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(lines).toEqual([expect.objectContaining({ text: 'oops', level: 'error' })])
  })

  it('resolves with non-zero exit code', async () => {
    spawnMock.mockReturnValue(fakeProc([], ['bad\n'], 2))
    const lines: LogLine[] = []
    const r = await runCommand('false', [], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(r.exitCode).toBe(2)
  })

  it('rejects when spawn emits error (ENOENT)', async () => {
    const proc = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable }
    proc.stdout = Readable.from([])
    proc.stderr = Readable.from([])
    setTimeout(() => proc.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })), 0)
    spawnMock.mockReturnValue(proc)
    await expect(runCommand('nope', [], { cwd: '/tmp', onLine: () => {} })).rejects.toThrow('ENOENT')
  })

  it('flushes trailing partial line without newline', async () => {
    spawnMock.mockReturnValue(fakeProc(['no-trailing-newline'], [], 0))
    const lines: LogLine[] = []
    await runCommand('x', [], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(lines.map((l) => l.text)).toEqual(['no-trailing-newline'])
  })

  it('forwards merged env vars to spawn', async () => {
    spawnMock.mockReturnValue(fakeProc(['ok\n'], [], 0))
    await runCommand('printenv', ['FOO'], {
      cwd: '/tmp',
      env: { FOO: 'bar' },
      onLine: () => {},
    })
    expect(spawnMock).toHaveBeenCalledWith('printenv', ['FOO'], expect.objectContaining({
      env: expect.objectContaining({ FOO: 'bar' }),
    }))
  })
})

