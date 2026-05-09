import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  cpSync,
} from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'

/**
 * Names we never want to mirror into the repo:
 * - `.backup.<timestamp>` artifacts left by install.ps1
 * - common dev/cache junk (.DS_Store, Thumbs.db)
 */
const IGNORED_NAME = /\.backup\.\d|^\.DS_Store$|^Thumbs\.db$/i

function isIgnored(name: string): boolean {
  return IGNORED_NAME.test(name)
}

/**
 * Returns true if src and dst resolve to the same filesystem entry.
 * Handles symlinks/junctions (common on Windows when install.ps1 uses Junction
 * for directories and falls back to copy for files — mixed mode).
 */
function isSamePath(src: string, dst: string): boolean {
  try {
    const realSrc = realpathSync(src)
    const realDst = existsSync(dst) ? realpathSync(dst) : resolvePath(dst)
    return realSrc === realDst
  } catch {
    return false
  }
}

function syncFile(src: string, dst: string): void {
  if (!existsSync(src)) return
  if (isSamePath(src, dst)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function syncDirMirror(src: string, dst: string): void {
  if (!existsSync(src)) {
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    return
  }
  if (isSamePath(src, dst)) return
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst)) {
      if (isIgnored(entry) || !existsSync(join(src, entry))) {
        rmSync(join(dst, entry), { recursive: true, force: true })
      }
    }
  }
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (isIgnored(entry)) continue
    const s = join(src, entry)
    const d = join(dst, entry)
    if (isSamePath(s, d)) continue
    // Use lstatSync first to detect dangling symlinks/junctions: a broken link
    // makes statSync (which follows links) throw ENOENT and abort the entire
    // export. Skip such entries — they're install-time leftovers, not data.
    let lst
    try {
      lst = lstatSync(s)
    } catch {
      continue
    }
    if (lst.isSymbolicLink() && !existsSync(s)) continue
    let stat
    try {
      stat = statSync(s)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      syncDirMirror(s, d)
    } else {
      cpSync(s, d)
    }
  }
}

function syncProjectsMemoryOnly(src: string, dst: string): void {
  if (!existsSync(src)) return
  for (const projectDir of readdirSync(src)) {
    const projectMemorySrc = join(src, projectDir, 'memory')
    const projectMemoryDst = join(dst, projectDir, 'memory')
    if (existsSync(projectMemorySrc)) {
      syncDirMirror(projectMemorySrc, projectMemoryDst)
    }
  }
}

export type ClaudeInstallMode = 'symlink' | 'copy'

export function detectClaudeInstallMode(claudePath: string): ClaudeInstallMode {
  const probe = join(claudePath, 'CLAUDE.md')
  if (!existsSync(probe)) return 'copy'
  try {
    if (lstatSync(probe).isSymbolicLink()) return 'symlink'
  } catch {
    /* ignore */
  }
  return 'copy'
}

/**
 * Mirror Claude's user-global config tree into <repoPath>/claude/.
 * Used by the push pipeline (after a target already exists in the repo).
 */
export function exportClaude(claudePath: string, repoPath: string): void {
  const dest = join(repoPath, 'claude')
  mkdirSync(dest, { recursive: true })

  syncFile(join(claudePath, 'CLAUDE.md'), join(dest, 'CLAUDE.md'))
  syncFile(join(claudePath, 'settings.json'), join(dest, 'settings.json'))
  syncDirMirror(join(claudePath, 'commands'), join(dest, 'commands'))
  syncDirMirror(join(claudePath, 'skills'), join(dest, 'skills'))
  syncProjectsMemoryOnly(join(claudePath, 'projects'), join(dest, 'projects'))
}

function copyFileIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function copyDirIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  // Filter mirrors IGNORED_NAME so init-time copy and push-time mirror agree:
  // `*.backup.<digit>...`, `.DS_Store`, `Thumbs.db` never enter the repo.
  cpSync(src, dst, {
    recursive: true,
    filter: (s) => {
      const base = s.split(/[/\\]/).pop() ?? ''
      return !isIgnored(base)
    },
  })
}

/**
 * Init-wizard variant: writes the initial Claude tree into <repoPath>/claude/
 * with `env` stripped from settings.json. Differs from exportClaude in that
 * it does not perform mirror-style cleanup (the destination is fresh).
 */
export function generateClaudeStructure(claudePath: string, repoPath: string): void {
  const globalDir = join(repoPath, 'claude')
  mkdirSync(globalDir, { recursive: true })

  copyFileIfExists(join(claudePath, 'CLAUDE.md'), join(globalDir, 'CLAUDE.md'))

  const settingsSrc = join(claudePath, 'settings.json')
  if (existsSync(settingsSrc)) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(readFileSync(settingsSrc, 'utf8')) as Record<string, unknown>
    } catch {
      parsed = {}
    }
    delete parsed.env
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify(parsed, null, 2), 'utf8')
  }

  copyDirIfExists(join(claudePath, 'commands'), join(globalDir, 'commands'))
  copyDirIfExists(join(claudePath, 'skills'), join(globalDir, 'skills'))

  const projectsSrc = join(claudePath, 'projects')
  const projectsDst = join(globalDir, 'projects')
  if (existsSync(projectsSrc)) {
    for (const dir of readdirSync(projectsSrc)) {
      const src = join(projectsSrc, dir, 'memory')
      const dst = join(projectsDst, dir, 'memory')
      copyDirIfExists(src, dst)
    }
  }
}

export function stripSecretsInClaudeRepo(repoPath: string): void {
  const settingsPath = join(repoPath, 'claude', 'settings.json')
  if (!existsSync(settingsPath)) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
  } catch {
    throw new Error('Invalid JSON in claude/settings.json — fix it before push')
  }
  if ('env' in parsed) {
    delete parsed.env
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2), 'utf8')
  }
}
