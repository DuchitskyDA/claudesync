import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  cpSync,
} from 'node:fs'
import { join, sep, posix } from 'node:path'
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
