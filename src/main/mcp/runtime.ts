import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { LogLine } from '@shared/api'
import { runCommand } from '../runner'

// ─── Internal helpers ─────────────────────────────────────────────────────────

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function makeLogLine(text: string, level: LogLine['level'] = 'info'): LogLine {
  return { time: nowHHMMSS(), text, level }
}

// ─── Platform helpers ─────────────────────────────────────────────────────────

const UVX = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? 'uvx.exe' : 'uvx'

// ─── Public pure functions ────────────────────────────────────────────────────

/**
 * Returns a list of candidate absolute paths where uvx might be installed,
 * ordered by preference.
 *
 * @param platform - target OS platform (defaults to process.platform)
 * @param env      - environment variables (defaults to process.env)
 * @param home     - user home directory (defaults to homedir())
 */
export function uvxCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string[] {
  if (platform === 'win32') {
    const appData = env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
    return [
      join(home, '.local', 'bin', 'uvx.exe'),
      join(appData, 'Python', 'Python314', 'Scripts', 'uvx.exe'),
      join(appData, 'Python', 'Python313', 'Scripts', 'uvx.exe'),
      join(appData, 'Python', 'Python312', 'Scripts', 'uvx.exe'),
    ]
  }
  return [
    join(home, '.local', 'bin', 'uvx'),
    '/opt/homebrew/bin/uvx',
    '/usr/local/bin/uvx',
    join(home, '.cargo', 'bin', 'uvx'),
  ]
}

/**
 * Returns the first candidate path that actually exists on disk, or null.
 *
 * @param candidates - list of absolute paths to check (defaults to uvxCandidates())
 */
export function findUvxOnDisk(candidates: string[] = uvxCandidates()): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

// ─── Async resolution ─────────────────────────────────────────────────────────

/**
 * Tries to find uvx:
 * 1. Checks known disk locations via findUvxOnDisk
 * 2. Falls back to `where`/`which` (system PATH lookup)
 *
 * Returns the absolute path to uvx, or null if not found.
 */
export async function resolveUvx(_emit: (l: LogLine) => void): Promise<string | null> {
  const found = findUvxOnDisk()
  if (found) return found

  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  const uvxName = UVX(process.platform)

  try {
    const result = await runCommand(whichCmd, [uvxName], {
      cwd: homedir(),
      onLine: () => {/* suppress output */},
      timeoutMs: 10000,
    })
    if (result.exitCode === 0) {
      const firstLine = result.stdout.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim()
      if (firstLine && existsSync(firstLine)) return firstLine
    }
  } catch {
    // not found via PATH
  }

  return null
}

// ─── Installation ─────────────────────────────────────────────────────────────

/**
 * Ensures uv/uvx is available. If not found, runs the official install script.
 * Returns the path to uvx after installation, or null if install failed.
 */
export async function ensureUv(emit: (l: LogLine) => void): Promise<string | null> {
  const found = await resolveUvx(emit)
  if (found) return found

  emit(makeLogLine('uv не найден — устанавливаю…'))

  if (process.platform === 'win32') {
    await runCommand(
      'powershell',
      ['-ExecutionPolicy', 'ByPass', '-NoProfile', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex'],
      { cwd: homedir(), onLine: emit, timeoutMs: 300000 },
    )
  } else {
    await runCommand(
      'sh',
      ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'],
      { cwd: homedir(), onLine: emit, timeoutMs: 300000 },
    )
  }

  return await resolveUvx(emit)
}

// ─── Prewarm ─────────────────────────────────────────────────────────────────

/**
 * Best-effort prewarm: runs `uvx <spec> --help` to download the package ahead
 * of first real use. Errors and timeouts are silently ignored.
 *
 * @param uvxPath - absolute path to the uvx binary
 * @param spec    - package spec, e.g. 'yandex-tracker-mcp@latest'
 */
export async function prewarm(
  uvxPath: string,
  spec: string,
  emit: (l: LogLine) => void,
): Promise<void> {
  try {
    await runCommand(uvxPath, [spec, '--help'], {
      cwd: homedir(),
      onLine: emit,
      timeoutMs: 120000,
    })
  } catch {
    // ignore — best-effort
  }
}

// ─── Cache cleanup ────────────────────────────────────────────────────────────

/**
 * Runs `uv cache clean <pkg>` to evict the cached version of a uvx package.
 * Errors are silently ignored.
 *
 * @param uvxPath - absolute path to uvx; uv is derived from it
 * @param pkg     - package name, e.g. 'yandex-tracker-mcp'
 */
export async function cleanCache(
  uvxPath: string,
  pkg: string,
  emit: (l: LogLine) => void,
): Promise<void> {
  const uv = uvxPath.replace(/uvx(\.exe)?$/i, (_m, ext) => 'uv' + (ext ?? ''))
  try {
    await runCommand(uv, ['cache', 'clean', pkg], {
      cwd: homedir(),
      onLine: emit,
      timeoutMs: 60000,
    })
  } catch {
    // ignore — best-effort
  }
}
