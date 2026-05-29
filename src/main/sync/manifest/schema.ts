// src/main/sync/manifest/schema.ts

export type ManifestSurface = 'claude-global' | 'project'
export type ManifestCategory =
  | 'claudeMd' | 'commands' | 'skills' | 'settings'
  | 'memory' | 'dotclaude'

export type ManifestFileEntry = {
  kind: 'file'
  id: string
  surface: ManifestSurface
  category: ManifestCategory
  project?: string
  path?: string // reserved for future glob support; not matched in №2
}

export type ManifestCapabilityEntry = {
  kind: 'capability'
  id: string
  capability: 'plugins' | 'mcp'
  data: unknown
}

export type ManifestEntry = ManifestFileEntry | ManifestCapabilityEntry

export type Manifest = { version: 1; entries: ManifestEntry[] }

const CATEGORIES: ReadonlySet<string> = new Set([
  'claudeMd', 'commands', 'skills', 'settings', 'memory', 'dotclaude',
])

function isFileEntry(e: Record<string, unknown>): boolean {
  if (typeof e.id !== 'string') return false
  if (e.surface !== 'claude-global' && e.surface !== 'project') return false
  if (typeof e.category !== 'string' || !CATEGORIES.has(e.category)) return false
  if (e.surface === 'project' && typeof e.project !== 'string') return false
  return true
}

function isCapabilityEntry(e: Record<string, unknown>): boolean {
  if (typeof e.id !== 'string') return false
  if (e.capability !== 'plugins' && e.capability !== 'mcp') return false
  return true
}

/** Parse + validate a manifest buffer. Throws with a clear message on any problem. */
export function parseManifest(buf: Buffer): Manifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(buf.toString('utf8'))
  } catch (e) {
    throw new Error(`manifest: invalid JSON: ${(e as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('manifest: not an object')
  const obj = parsed as Record<string, unknown>
  if (obj.version !== 1) throw new Error(`manifest: unsupported version ${String(obj.version)} (expected 1)`)
  if (!Array.isArray(obj.entries)) throw new Error('manifest: entries must be an array')
  const entries: ManifestEntry[] = obj.entries.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`manifest: entry ${i} not an object`)
    const e = raw as Record<string, unknown>
    if (e.kind === 'file') {
      if (!isFileEntry(e)) throw new Error(`manifest: invalid file entry at ${i}`)
      const fe: ManifestFileEntry = {
        kind: 'file', id: e.id as string,
        surface: e.surface as ManifestSurface, category: e.category as ManifestCategory,
      }
      if (typeof e.project === 'string') fe.project = e.project
      if (typeof e.path === 'string') fe.path = e.path
      return fe
    }
    if (e.kind === 'capability') {
      if (!isCapabilityEntry(e)) throw new Error(`manifest: invalid capability entry at ${i}`)
      return { kind: 'capability', id: e.id as string, capability: e.capability as 'plugins' | 'mcp', data: e.data }
    }
    throw new Error(`manifest: unknown entry kind at ${i}: ${String(e.kind)}`)
  })
  return { version: 1, entries }
}

/** Stable, pretty serialization (2-space indent, trailing newline). */
export function serializeManifest(m: Manifest): Buffer {
  return Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8')
}
