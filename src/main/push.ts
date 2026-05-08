import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  cpSync,
} from 'node:fs'
import { join } from 'node:path'

export type InstallMode = 'symlink' | 'copy'

export function detectInstallMode(rulesTarget: string, _repoPath: string): InstallMode {
  const probe = join(rulesTarget, 'CLAUDE.md')
  if (!existsSync(probe)) return 'copy'
  try {
    const stat = lstatSync(probe)
    if (stat.isSymbolicLink()) return 'symlink'
  } catch {
    // ignore
  }
  return 'copy'
}

function syncFile(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(join(dst, '..'), { recursive: true })
  cpSync(src, dst)
}

function syncDirMirror(src: string, dst: string): void {
  if (!existsSync(src)) {
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    return
  }
  // Remove dst entries that don't exist in src (mirror semantics)
  if (existsSync(dst)) {
    for (const entry of readdirSync(dst)) {
      if (!existsSync(join(src, entry))) {
        rmSync(join(dst, entry), { recursive: true, force: true })
      }
    }
  }
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    const stat = statSync(s)
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

export function exportRulesToRepo(rulesTarget: string, repoPath: string): void {
  const globalDir = join(repoPath, 'global')
  mkdirSync(globalDir, { recursive: true })

  // file mirror
  syncFile(join(rulesTarget, 'CLAUDE.md'), join(globalDir, 'CLAUDE.md'))
  syncFile(join(rulesTarget, 'settings.json'), join(globalDir, 'settings.json'))

  // dir mirror
  syncDirMirror(join(rulesTarget, 'commands'), join(globalDir, 'commands'))
  syncDirMirror(join(rulesTarget, 'skills'), join(globalDir, 'skills'))

  // projects — only memory subdirs (mirror within memory/, leave rest alone)
  syncProjectsMemoryOnly(join(rulesTarget, 'projects'), join(globalDir, 'projects'))
}

export function stripSecretsInRepo(repoPath: string): void {
  const settingsPath = join(repoPath, 'global', 'settings.json')
  if (!existsSync(settingsPath)) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
  } catch {
    throw new Error('Invalid JSON in global/settings.json — fix it before push')
  }
  if ('env' in parsed) {
    delete parsed.env
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2), 'utf8')
  }
}
