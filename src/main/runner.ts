import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { LogLine } from '@shared/api'

export type RunOptions = {
  cwd: string
  onLine: (line: LogLine) => void
}

export type RunCommandResult = { exitCode: number }

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function streamToLines(
  stream: Readable,
  level: 'info' | 'error',
  onLine: (line: LogLine) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let buf = ''
    stream.setEncoding?.('utf8')
    stream.on('data', (chunk: string) => {
      buf += chunk
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      for (const part of parts) {
        onLine({ time: nowHHMMSS(), text: part, level })
      }
    })
    stream.on('end', () => {
      if (buf.length > 0) onLine({ time: nowHHMMSS(), text: buf, level })
      resolve()
    })
  })
}

export function runCommand(
  cmd: string,
  args: string[],
  opts: RunOptions,
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd, shell: false })
    const outDone = streamToLines(proc.stdout, 'info', opts.onLine)
    const errDone = streamToLines(proc.stderr, 'error', opts.onLine)
    proc.on('error', (err) => reject(err))
    proc.on('exit', async (code) => {
      await Promise.all([outDone, errDone])
      resolve({ exitCode: code ?? 1 })
    })
  })
}
