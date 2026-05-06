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
