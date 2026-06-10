import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { LogLine } from '@shared/api'

export type RunOptions = {
  cwd: string
  env?: Record<string, string>
  onLine: (line: LogLine) => void
}

export type RunCommandResult = { exitCode: number; stdout: string; stderr: string }

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function captureStream(
  stream: Readable,
  level: 'info' | 'error',
  onLine: (line: LogLine) => void,
  onData: (chunk: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let buf = ''
    stream.setEncoding?.('utf8')
    stream.on('data', (chunk: string) => {
      buf += chunk
      onData(chunk)
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
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: false,
      env: opts.env ? { ...process.env, ...opts.env } as NodeJS.ProcessEnv : process.env,
    })
    let stdout = ''
    let stderr = ''
    const outDone = captureStream(proc.stdout, 'info', opts.onLine, (c) => { stdout += c })
    const errDone = captureStream(proc.stderr, 'error', opts.onLine, (c) => { stderr += c })
    proc.on('error', (err) => reject(err))
    proc.on('exit', async (code) => {
      await Promise.all([outDone, errDone])
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}

