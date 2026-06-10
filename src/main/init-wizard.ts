import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  chmodSync,
} from 'node:fs'
import { join, sep, posix, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import type { LogLine, RunResult, StepStatus, InitStep, LocalizedMessage } from '@shared/api'
import { runCommand } from './runner'
import { withExclusiveLock } from './sync/engine/op-lock'
import { createRepo as ghCreateRepo } from './github-api'
import { loadToken } from './safe-storage'
import type { ScanResult } from '@shared/api'
import { generateClaudeStructure } from './sync/claude'

const RUNTIME_TOP_DIRS = [
  'sessions',
  'session-env',
  'shell-snapshots',
  'telemetry',
  'cache',
  'image-cache',
  'paste-cache',
  'file-history',
  'downloads',
  'ide',
  'backups',
  'tasks',
  'plans',
  'plugins',
]
const RUNTIME_TOP_FILES = [
  'history.jsonl',
  'mcp-needs-auth-cache.json',
  '.credentials.json',
  'settings.local.json',
]
const RUNTIME_PROJECT_DIRS = ['sessions']

/**
 * Names that are install-time/runtime junk and should NEVER be carried into
 * the sync repo. Matches the runtime exporter's filter
 * (src/main/sync/claude.ts → IGNORED_NAME) so init-time scan and push-time
 * export agree on what's worth syncing.
 *   - `*.backup.<digit>...` — install.ps1/sh leftover backups
 *   - `.DS_Store`, `Thumbs.db` — OS junk
 */
const IGNORED_NAME = /\.backup\.\d|^\.DS_Store$|^Thumbs\.db$/i

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep)
}

type WalkResult = { included: string[]; excluded: string[]; sizes: Record<string, number> }

function walk(root: string, rel = ''): WalkResult {
  const result: WalkResult = { included: [], excluded: [], sizes: {} }
  if (!existsSync(root)) return result
  const fullDir = rel === '' ? root : join(root, rel)
  if (!existsSync(fullDir)) return result

  for (const entry of readdirSync(fullDir)) {
    const relPath = rel === '' ? entry : `${rel}/${entry}`
    const fullPath = join(root, relPath)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    // Universal junk filter — install backups, OS metadata.
    if (IGNORED_NAME.test(entry)) {
      result.excluded.push(toPosix(relPath))
      continue
    }

    // Top-level filtering
    if (rel === '') {
      if (RUNTIME_TOP_DIRS.includes(entry) && stat.isDirectory()) {
        result.excluded.push(toPosix(relPath))
        continue
      }
      if (RUNTIME_TOP_FILES.includes(entry) && stat.isFile()) {
        result.excluded.push(toPosix(relPath))
        continue
      }
      if (entry === '.git') {
        result.excluded.push(toPosix(relPath))
        continue
      }
    }

    // Inside projects/<encoded>/ — exclude sessions and *.jsonl, allow only memory
    if (rel.startsWith('projects/') && rel.split('/').length === 2) {
      if (RUNTIME_PROJECT_DIRS.includes(entry) && stat.isDirectory()) {
        result.excluded.push(toPosix(relPath))
        continue
      }
      if (entry.endsWith('.jsonl') && stat.isFile()) {
        result.excluded.push(toPosix(relPath))
        continue
      }
      if (entry !== 'memory') {
        result.excluded.push(toPosix(relPath))
        continue
      }
    }

    if (stat.isDirectory()) {
      const child = walk(root, relPath)
      result.included.push(...child.included)
      result.excluded.push(...child.excluded)
      Object.assign(result.sizes, child.sizes)
    } else if (stat.isFile()) {
      const posixPath = toPosix(relPath)
      result.included.push(posixPath)
      result.sizes[posixPath] = stat.size
    }
  }
  return result
}

export function scanLocalConfig(rulesTarget: string): ScanResult {
  const { included, excluded, sizes } = walk(rulesTarget)
  const totalSize = Object.values(sizes).reduce((a, b) => a + b, 0)
  return {
    files: included.sort(),
    excluded: excluded.sort(),
    totalSize,
  }
}

/** Backwards-compat re-export. Logic moved to src/main/sync/claude.ts. */
export const generateGlobalStructure = generateClaudeStructure

/**
 * Create an empty skeleton: claude/ and cursor/projects/ with .gitkeep files
 * so git tracks the directories. No data is copied at init time — the user
 * fills these via the regular Push flow once targets are configured.
 */
export function generateEmptySkeleton(repoPath: string): void {
  const stake = (relDir: string) => {
    const dir = join(repoPath, relDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.gitkeep'), '')
  }
  stake('claude')
  stake('cursor/projects')
}

// ---------------------------------------------------------------------------
// Embedded templates
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _app: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('electron').app
  } catch {
    return undefined
  }
})()

const _moduleDir = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return ''
  }
})()

export function templatesDir(): string {
  if (_app && _app.isPackaged) {
    return join(process.resourcesPath, 'templates')
  }
  return join(_moduleDir, '../../src/main/templates')
}

export type TemplateContext = {
  name: string
  owner: string
}

export function dropTemplatesFrom(
  tplDir: string,
  repoPath: string,
  ctx: TemplateContext,
): void {
  const year = String(new Date().getFullYear())
  const tplFiles: { src: string; dst: string }[] = [
    { src: 'install.sh.template', dst: 'install.sh' },
    { src: 'install.ps1.template', dst: 'install.ps1' },
    { src: 'README.md.template', dst: 'README.md' },
    { src: 'LICENSE.template', dst: 'LICENSE' },
    { src: 'gitignore.template', dst: '.gitignore' },
  ]

  for (const t of tplFiles) {
    const srcPath = join(tplDir, t.src)
    if (!existsSync(srcPath)) continue
    let content = readFileSync(srcPath, 'utf8')
    content = content
      .replace(/\{\{name\}\}/g, ctx.name)
      .replace(/\{\{owner\}\}/g, ctx.owner)
      .replace(/\{\{year\}\}/g, year)
    writeFileSync(join(repoPath, t.dst), content, 'utf8')
  }

  // Make install.sh executable on Unix
  const installSh = join(repoPath, 'install.sh')
  if (existsSync(installSh)) {
    try {
      chmodSync(installSh, 0o755)
    } catch {
      // ignore on Windows where chmod is no-op
    }
  }
}

export function dropTemplates(repoPath: string, ctx: TemplateContext): void {
  return dropTemplatesFrom(templatesDir(), repoPath, ctx)
}

// ---------------------------------------------------------------------------
// initRepo orchestration
// ---------------------------------------------------------------------------

function defaultManagedRepoPath(url: string, userDataDir: string): string {
  const sha = createHash('sha256').update(url).digest('hex').slice(0, 12)
  return join(userDataDir, 'repos', sha)
}

function authArgs(token: string): string[] {
  // GitHub git-over-HTTPS requires Basic auth with x-access-token; Bearer is rejected.
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return ['-c', `http.extraheader=Authorization: Basic ${basic}`]
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Run a `runCommand`-style action with retries + exponential-ish backoff.
 * Used for the network-touching git steps (clone, push) that often fail
 * the first time right after the GitHub repo was created (propagation lag)
 * or briefly when the network blips.
 */
async function runCommandRetry(
  label: string,
  attempts: number,
  emit: (l: LogLine) => void,
  exec: () => Promise<{ exitCode: number }>,
): Promise<{ exitCode: number }> {
  let last: { exitCode: number } = { exitCode: -1 }
  for (let i = 0; i < attempts; i++) {
    last = await exec()
    if (last.exitCode === 0) return last
    if (i < attempts - 1) {
      const wait = 1000 * (i + 1) // 1s, 2s, …
      emit({
        time: nowHHMMSS(),
        text: `${label} failed (exit ${last.exitCode}) — retrying in ${wait / 1000}s (${i + 2}/${attempts})…`,
        level: 'info',
      })
      await sleep(wait)
    }
  }
  return last
}

export type InitRepoOpts = {
  ownerLogin: string
  name: string
  isPrivate: boolean
  description?: string
  userDataDir: string
  tplDir: string
  emit: (line: LogLine) => void
  emitStep: (e: { step: InitStep; status: StepStatus; message?: LocalizedMessage }) => void
}

export type InitRepoResult = RunResult & { repoUrl?: string; repoPath?: string }

function fail(error: LocalizedMessage): InitRepoResult {
  return { ok: false, exitCode: -1, error }
}

function failWithCode(code: number, error: LocalizedMessage): InitRepoResult {
  return { ok: false, exitCode: code, error }
}

export async function initRepo(opts: InitRepoOpts): Promise<InitRepoResult> {
  const token = loadToken(opts.userDataDir)
  if (!token) return fail({ key: 'init.error.notSignedIn' })

  return withExclusiveLock('init-repo', async () => {
    // We deliberately create the GitHub repo LAST (step 4). Everything before
    // that is local-only — if any of those steps fail, we wipe the local dir
    // and exit cleanly with no GitHub side-effects. Only step 4+5 can leave
    // a remote artifact, and step 4 is just an API call (very rarely flaky)
    // while step 5 is retried.

    // Compute the deterministic local path. We can't derive it from the
    // remote URL until step 4, so use the (owner, name) tuple instead.
    const stableKey = `https://github.com/${opts.ownerLogin}/${opts.name}.git`
    const localPath = defaultManagedRepoPath(stableKey, opts.userDataDir)
    const wipeLocal = () => {
      try {
        rmSync(localPath, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }

    // Step 1: init local repo (mkdir + git init)
    opts.emitStep({ step: 'init-local', status: 'running' })
    try {
      // If a previous failed attempt left files behind, start clean.
      if (existsSync(localPath)) rmSync(localPath, { recursive: true, force: true })
      mkdirSync(localPath, { recursive: true })
    } catch (e) {
      const msg = (e as Error).message
      opts.emitStep({ step: 'init-local', status: 'failed', message: { key: 'init.error.generic', params: { reason: msg }, fallback: msg } })
      return fail({ key: 'init.error.generic', params: { reason: msg }, fallback: msg })
    }
    const initResult = await runCommand('git', ['-C', localPath, 'init', '-b', 'main'], {
      cwd: localPath,
      onLine: opts.emit,
    })
    if (initResult.exitCode !== 0) {
      wipeLocal()
      opts.emitStep({ step: 'init-local', status: 'failed' })
      return failWithCode(initResult.exitCode, { key: 'init.error.gitInitFailed', params: { code: initResult.exitCode } })
    }
    opts.emitStep({ step: 'init-local', status: 'done' })

    // Step 2: skeleton + templates
    opts.emitStep({ step: 'generate', status: 'running' })
    try {
      generateEmptySkeleton(localPath)
      dropTemplatesFrom(opts.tplDir, localPath, { name: opts.name, owner: opts.ownerLogin })
    } catch (e) {
      wipeLocal()
      const msg = (e as Error).message
      opts.emitStep({ step: 'generate', status: 'failed', message: { key: 'init.error.generic', params: { reason: msg }, fallback: msg } })
      return fail({ key: 'init.error.generic', params: { reason: msg }, fallback: msg })
    }
    opts.emitStep({ step: 'generate', status: 'done' })

    // Step 3: commit
    opts.emitStep({ step: 'commit', status: 'running' })
    const addResult = await runCommand('git', ['-C', localPath, 'add', '-A'], {
      cwd: localPath,
      onLine: opts.emit,
    })
    if (addResult.exitCode !== 0) {
      wipeLocal()
      opts.emitStep({ step: 'commit', status: 'failed' })
      return fail({ key: 'init.error.commitFailed' })
    }
    const commitResult = await runCommand(
      'git',
      [
        '-C', localPath,
        '-c', 'user.email=claudesync@noreply',
        '-c', 'user.name=claudesync',
        'commit', '-m', 'initial commit from claudesync',
      ],
      { cwd: localPath, onLine: opts.emit },
    )
    if (commitResult.exitCode !== 0) {
      wipeLocal()
      opts.emitStep({ step: 'commit', status: 'failed' })
      return fail({ key: 'init.error.commitFailed' })
    }
    opts.emitStep({ step: 'commit', status: 'done' })

    // Step 4: create GitHub repo (last point at which we leave no side-effects on failure)
    opts.emitStep({ step: 'create-remote', status: 'running' })
    let cloneUrl: string
    try {
      const repo = await ghCreateRepo(token, {
        owner: opts.ownerLogin,
        name: opts.name,
        isPrivate: opts.isPrivate,
        description: opts.description,
      })
      cloneUrl = repo.clone_url
      opts.emit({ time: nowHHMMSS(), text: `✓ Created ${repo.full_name}`, level: 'info' })
      opts.emitStep({ step: 'create-remote', status: 'done' })
    } catch (e) {
      wipeLocal()
      const msg = (e as Error).message
      opts.emitStep({ step: 'create-remote', status: 'failed', message: { key: 'init.error.createRepoFailed', params: { reason: msg }, fallback: msg } })
      return fail({ key: 'init.error.createRepoFailed', params: { reason: msg }, fallback: msg })
    }

    // Step 5: add remote + push (retried — network)
    opts.emitStep({ step: 'push', status: 'running' })
    const remoteResult = await runCommand(
      'git', ['-C', localPath, 'remote', 'add', 'origin', cloneUrl],
      { cwd: localPath, onLine: opts.emit },
    )
    if (remoteResult.exitCode !== 0) {
      // Local-only failure. GitHub repo exists but is empty — surface that.
      opts.emitStep({ step: 'push', status: 'failed' })
      return failWithCode(remoteResult.exitCode, {
        key: 'init.error.pushFailedKeepRepo',
        params: { code: remoteResult.exitCode, repoUrl: cloneUrl.replace(/\.git$/, '') },
        fallback: `git remote add failed (exit ${remoteResult.exitCode}). Empty repo exists at ${cloneUrl.replace(/\.git$/, '')}.`,
      })
    }
    const pushResult = await runCommandRetry('git push', 3, opts.emit, () =>
      runCommand(
        'git',
        [...authArgs(token), '-C', localPath, 'push', '-u', 'origin', 'main'],
        { cwd: localPath, onLine: opts.emit },
      ),
    )
    if (pushResult.exitCode !== 0) {
      opts.emitStep({ step: 'push', status: 'failed' })
      return failWithCode(pushResult.exitCode, {
        key: 'init.error.pushFailedKeepRepo',
        params: { code: pushResult.exitCode, repoUrl: cloneUrl.replace(/\.git$/, '') },
        fallback: `git push failed after retries (exit ${pushResult.exitCode}). Repo was created at ${cloneUrl.replace(/\.git$/, '')}; you can push manually from ${localPath}.`,
      })
    }
    opts.emitStep({ step: 'push', status: 'done' })

    return { ok: true, exitCode: 0, repoUrl: cloneUrl, repoPath: localPath }
  }).catch((e: Error) => fail({ key: 'init.error.generic', params: { reason: e.message }, fallback: e.message }))
}
