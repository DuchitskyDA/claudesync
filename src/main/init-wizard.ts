import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  cpSync,
  chmodSync,
} from 'node:fs'
import { join, sep, posix, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import type { LogLine, RunResult, StepStatus, InitStep } from '@shared/api'
import { runCommand, withRunLock } from './runner'
import { createRepo as ghCreateRepo } from './github-api'
import { loadToken } from './safe-storage'
import type { ScanResult } from '@shared/api'

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

function copyFileIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function copyDirIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, { recursive: true })
}

export function generateGlobalStructure(rulesTarget: string, repoPath: string): void {
  const globalDir = join(repoPath, 'global')
  mkdirSync(globalDir, { recursive: true })

  // CLAUDE.md
  copyFileIfExists(join(rulesTarget, 'CLAUDE.md'), join(globalDir, 'CLAUDE.md'))

  // settings.json — strip env
  const settingsSrc = join(rulesTarget, 'settings.json')
  if (existsSync(settingsSrc)) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(readFileSync(settingsSrc, 'utf8'))
    } catch {
      parsed = {}
    }
    delete parsed.env
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify(parsed, null, 2), 'utf8')
  }

  // commands, skills — full mirror
  copyDirIfExists(join(rulesTarget, 'commands'), join(globalDir, 'commands'))
  copyDirIfExists(join(rulesTarget, 'skills'), join(globalDir, 'skills'))

  // projects/<encoded>/memory — only memory subdir
  const projectsSrc = join(rulesTarget, 'projects')
  const projectsDst = join(globalDir, 'projects')
  if (existsSync(projectsSrc)) {
    for (const dir of readdirSync(projectsSrc)) {
      const src = join(projectsSrc, dir, 'memory')
      const dst = join(projectsDst, dir, 'memory')
      copyDirIfExists(src, dst)
    }
  }
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
  return ['-c', `http.extraheader=Authorization: Bearer ${token}`]
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export type InitRepoOpts = {
  ownerLogin: string
  name: string
  isPrivate: boolean
  description?: string
  rulesTarget: string
  userDataDir: string
  tplDir: string
  emit: (line: LogLine) => void
  emitStep: (e: { step: InitStep; status: StepStatus; message?: string }) => void
}

export type InitRepoResult = RunResult & { repoUrl?: string; repoPath?: string }

function fail(error: string): InitRepoResult {
  return { ok: false, exitCode: -1, error }
}

export async function initRepo(opts: InitRepoOpts): Promise<InitRepoResult> {
  const token = loadToken(opts.userDataDir)
  if (!token) return fail('Not signed in to GitHub. Sign in first.')

  return withRunLock(async () => {
    // Step 1: create repo via API
    opts.emitStep({ step: 'create-repo', status: 'running' })
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
      opts.emitStep({ step: 'create-repo', status: 'done' })
    } catch (e) {
      const msg = (e as Error).message
      opts.emitStep({ step: 'create-repo', status: 'failed', message: msg })
      return fail(msg)
    }

    // Step 2: clone empty repo
    const localPath = defaultManagedRepoPath(cloneUrl, opts.userDataDir)
    mkdirSync(dirname(localPath), { recursive: true })
    opts.emitStep({ step: 'clone', status: 'running' })
    const cloneResult = await runCommand(
      'git',
      [...authArgs(token), 'clone', cloneUrl, localPath],
      {
        cwd: dirname(localPath),
        onLine: opts.emit,
      },
    )
    if (cloneResult.exitCode !== 0) {
      opts.emitStep({ step: 'clone', status: 'failed' })
      return fail(`git clone failed (exit ${cloneResult.exitCode})`)
    }
    opts.emitStep({ step: 'clone', status: 'done' })

    // Step 3: generate global/ + drop templates
    opts.emitStep({ step: 'generate', status: 'running' })
    try {
      generateGlobalStructure(opts.rulesTarget, localPath)
      dropTemplatesFrom(opts.tplDir, localPath, { name: opts.name, owner: opts.ownerLogin })
    } catch (e) {
      opts.emitStep({ step: 'generate', status: 'failed', message: (e as Error).message })
      return fail((e as Error).message)
    }
    opts.emitStep({ step: 'generate', status: 'done' })

    // Step 4: commit (add then commit)
    opts.emitStep({ step: 'commit', status: 'running' })
    const addResult = await runCommand('git', ['-C', localPath, 'add', '-A'], {
      cwd: localPath,
      onLine: opts.emit,
    })
    if (addResult.exitCode !== 0) {
      opts.emitStep({ step: 'commit', status: 'failed' })
      return fail('git add failed')
    }
    const commitResult = await runCommand(
      'git',
      [
        '-C',
        localPath,
        '-c',
        'user.email=claudesync@noreply',
        '-c',
        'user.name=claudesync',
        'commit',
        '-m',
        'initial commit from claudesync',
      ],
      { cwd: localPath, onLine: opts.emit },
    )
    if (commitResult.exitCode !== 0) {
      opts.emitStep({ step: 'commit', status: 'failed' })
      return fail('initial commit failed')
    }
    opts.emitStep({ step: 'commit', status: 'done' })

    // Step 5: push
    opts.emitStep({ step: 'push', status: 'running' })
    const pushResult = await runCommand(
      'git',
      [...authArgs(token), '-C', localPath, 'push', '-u', 'origin', 'main'],
      { cwd: localPath, onLine: opts.emit },
    )
    if (pushResult.exitCode !== 0) {
      opts.emitStep({ step: 'push', status: 'failed' })
      return fail(`push failed (exit ${pushResult.exitCode})`)
    }
    opts.emitStep({ step: 'push', status: 'done' })

    return { ok: true, exitCode: 0, repoUrl: cloneUrl, repoPath: localPath }
  }).catch((e: Error) => fail(e.message))
}
