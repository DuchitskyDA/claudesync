// src/shared/sync-types.ts

/** What kind of source surface this entry belongs to. */
export type SourceKind = 'claude' | 'cursor-project'

/** Reference to a surface — either Claude global or a named Cursor project. */
export type SourceRef =
  | { kind: 'claude' }
  | { kind: 'cursor-project'; projectName: string }

/** A single file in source or HEAD. */
export type FileEntry = {
  /** Path within the repo, e.g. 'claude/CLAUDE.md' or 'cursor/projects/Foo/.cursorrules'. */
  repoPath: string
  /** Path within the source surface, e.g. 'CLAUDE.md' or '.cursorrules'. */
  surfacePath: string
  /** SHA-1 of canonical content (settings.json filtered + 2-space stringify; everything else raw bytes). */
  sha1: string
  /** Posix file mode — 100644 for regular file, 100755 for executable. */
  mode: '100644' | '100755'
  /** Byte size of canonical content. */
  size: number
}

export type DiffStatus = 'added' | 'modified' | 'deleted' | 'same'

export type DiffEntry = {
  source: SourceRef
  repoPath: string
  surfacePath: string
  status: DiffStatus
  sourceSha?: string
  headSha?: string
}

export type PreviewItem = DiffEntry & {
  /** Raw file content from origin/main, ready to write to source. */
  newContent?: Buffer
  /** Current source content for "before" view, when available. */
  currentContent?: Buffer
}

export type ResolverFile = {
  source: SourceRef
  repoPath: string
  surfacePath: string
  base: Buffer | null
  mine: Buffer | null
  theirs: Buffer | null
  choice: 'mine' | 'theirs' | 'manual' | null
  editedContent?: Buffer
}

export type ResolverState = {
  files: ResolverFile[]
  baseSha: string
  headSha: string
  theirsSha: string
}

export type EngineStatus = {
  state: 'in-sync' | 'local-changes' | 'ahead' | 'behind' | 'diverged' | 'offline' | 'no-remote' | 'unknown'
  ahead: number
  behind: number
  localChanges: number
  diffs: DiffEntry[]
  fetchedAt: number | null
  errorKey?: string
}
