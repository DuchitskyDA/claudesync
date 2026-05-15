import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { createHash } from 'node:crypto'
import type { FileEntry } from '@shared/sync-types'
import { isClaudePathSynced, isClaudePathIgnored, isCursorPathSynced } from './rules'
import { canonicalizeSettings } from './settings-canonical'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB

function sha1OfBlob(content: Buffer): string {
  // git blob sha: sha1("blob <len>\0<content>")
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(content).digest('hex')
}

function toRepoPath(parts: string[]): string {
  return posix.join(...parts)
}

function walk(rootAbs: string, prefixParts: string[], cb: (relPosix: string, abs: string) => void): void {
  if (!existsSync(rootAbs)) return
  let entries: string[]
  try { entries = readdirSync(rootAbs) } catch { return }
  for (const name of entries) {
    const abs = join(rootAbs, name)
    let lst
    try { lst = lstatSync(abs) } catch { continue }
    if (lst.isSymbolicLink() && !existsSync(abs)) continue
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) {
      walk(abs, [...prefixParts, name], cb)
    } else if (st.isFile()) {
      const rel = posix.join(...prefixParts, name)
      cb(rel, abs)
    }
  }
}

/** Walks ~/.claude, returns synced file entries. */
export async function enumClaudeSource(claudePath: string): Promise<FileEntry[]> {
  if (!existsSync(claudePath)) return []
  const out: FileEntry[] = []
  walk(claudePath, [], (rel, abs) => {
    if (isClaudePathIgnored(rel)) return
    if (!isClaudePathSynced(rel)) return
    let st
    try { st = statSync(abs) } catch { return }
    if (st.size > MAX_BYTES) return
    let content: Buffer
    try { content = readFileSync(abs) } catch { return }
    if (rel === 'settings.json') {
      try { content = canonicalizeSettings(content) } catch { return }
    }
    const sha1 = sha1OfBlob(content)
    out.push({
      repoPath: `claude/${rel}`,
      surfacePath: rel,
      sha1,
      mode: '100644',
      size: content.length,
    })
  })
  return out
}

/** Walks a Cursor project root, returns synced .cursor/* + .cursorrules entries. */
export async function enumCursorProjectSource(projectPath: string, projectName: string): Promise<FileEntry[]> {
  if (!existsSync(projectPath)) return []
  const out: FileEntry[] = []
  walk(projectPath, [], (rel, abs) => {
    if (!isCursorPathSynced(rel)) return
    let st
    try { st = statSync(abs) } catch { return }
    if (st.size > MAX_BYTES) return
    let content: Buffer
    try { content = readFileSync(abs) } catch { return }
    const sha1 = sha1OfBlob(content)
    out.push({
      repoPath: `cursor/projects/${projectName}/${rel}`,
      surfacePath: rel,
      sha1,
      mode: '100644',
      size: content.length,
    })
  })
  return out
}

/** Helper used by IndexBuilder: read raw bytes of a source file (with canonicalization for settings.json). */
export function readSourceForCommit(surfaceAbsPath: string, surfaceRelPath: string): Buffer {
  let content = readFileSync(surfaceAbsPath)
  if (surfaceRelPath === 'settings.json') content = canonicalizeSettings(content)
  return content
}
