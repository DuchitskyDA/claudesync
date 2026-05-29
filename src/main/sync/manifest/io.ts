// src/main/sync/manifest/io.ts
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseManifest, serializeManifest, type Manifest } from './schema'

const MANIFEST_REL = join('.claudesync', 'manifest.json')

function manifestPath(repoPath: string): string {
  return join(repoPath, MANIFEST_REL)
}

let atomicCounter = 0

/** Read + parse the repo manifest. Returns null if absent. Throws on broken content. */
export function readManifest(repoPath: string): Manifest | null {
  const p = manifestPath(repoPath)
  if (!existsSync(p)) return null
  return parseManifest(readFileSync(p))
}

/** Atomic write (temp+rename) of the manifest into <repo>/.claudesync/manifest.json. */
export async function writeManifest(repoPath: string, m: Manifest): Promise<void> {
  const p = manifestPath(repoPath)
  mkdirSync(join(repoPath, '.claudesync'), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}-${atomicCounter++}`
  try {
    writeFileSync(tmp, serializeManifest(m))
    renameSync(tmp, p)
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
}
