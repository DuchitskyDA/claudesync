import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCursorProject, installCursorProjects } from '../../src/main/sync/cursor-install'
import { beginSnapshot } from '../../src/main/sync/engine/safety-snapshot'

let dir: string
let repoPath: string
let projectPath: string
let userDataDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-ci-'))
  repoPath = join(dir, 'repo')
  projectPath = join(dir, 'app')
  userDataDir = join(dir, 'ud')
  mkdirSync(repoPath, { recursive: true })
  mkdirSync(projectPath, { recursive: true })
  mkdirSync(userDataDir, { recursive: true })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('installCursorProject', () => {
  it('mirrors repo cursor/projects/<name>/{rules,skills} into <project>/.cursor/', () => {
    const src = join(repoPath, 'cursor', 'projects', 'app')
    mkdirSync(join(src, 'rules'), { recursive: true })
    writeFileSync(join(src, 'rules', 'a.mdc'), 'R')
    mkdirSync(join(src, 'skills', 'sk'), { recursive: true })
    writeFileSync(join(src, 'skills', 'sk', 'SKILL.md'), 'S')
    writeFileSync(join(src, '.cursorrules'), 'legacy')

    const session = beginSnapshot(userDataDir, 'test')
    installCursorProject(repoPath, { name: 'app', path: projectPath }, session)
    session.commit()

    expect(readFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'utf8')).toBe('R')
    expect(readFileSync(join(projectPath, '.cursor', 'skills', 'sk', 'SKILL.md'), 'utf8')).toBe('S')
    expect(readFileSync(join(projectPath, '.cursorrules'), 'utf8')).toBe('legacy')
  })

  it('overwrites existing files (no backup)', () => {
    const src = join(repoPath, 'cursor', 'projects', 'app')
    mkdirSync(join(src, 'rules'), { recursive: true })
    writeFileSync(join(src, 'rules', 'a.mdc'), 'NEW')

    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'OLD')

    const session = beginSnapshot(userDataDir, 'test')
    installCursorProject(repoPath, { name: 'app', path: projectPath }, session)
    session.commit()

    expect(readFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'utf8')).toBe('NEW')
    // No .backup files anywhere
    const after = (path: string) => (existsSync(path) ? readdirSync(path) : [])
    expect(after(join(projectPath, '.cursor', 'rules')).filter((n) => n.includes('.backup'))).toEqual([])
  })

  it('preserves local-only files in destination (additive semantics)', () => {
    // Reverse-mirror must never delete a user's local-only rule just
    // because the repo doesn't have it — that turned Discard into a
    // data-loss action before v0.9.6. The destructive forward-mirror
    // (push pipeline) still removes orphans on the way out, since source
    // dirs are the source of truth on push.
    const src = join(repoPath, 'cursor', 'projects', 'app')
    mkdirSync(join(src, 'rules'), { recursive: true })
    writeFileSync(join(src, 'rules', 'keep.mdc'), 'K')

    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'keep.mdc'), 'OLD')
    writeFileSync(join(projectPath, '.cursor', 'rules', 'local-only.mdc'), 'KEEP-ME')

    const session = beginSnapshot(userDataDir, 'test')
    installCursorProject(repoPath, { name: 'app', path: projectPath }, session)
    session.commit()

    // Repo wins on shared file (overwrite).
    expect(readFileSync(join(projectPath, '.cursor', 'rules', 'keep.mdc'), 'utf8')).toBe('K')
    // Local-only file survives.
    expect(readFileSync(join(projectPath, '.cursor', 'rules', 'local-only.mdc'), 'utf8')).toBe(
      'KEEP-ME',
    )
  })

  it('preserves a legacy local .cursorrules when source no longer has it', () => {
    mkdirSync(join(repoPath, 'cursor', 'projects', 'app'), { recursive: true })
    writeFileSync(join(projectPath, '.cursorrules'), 'local-legacy')

    const session = beginSnapshot(userDataDir, 'test')
    installCursorProject(repoPath, { name: 'app', path: projectPath }, session)
    session.commit()

    // Same rule as above: reverse-mirror is additive only, never destructive.
    expect(readFileSync(join(projectPath, '.cursorrules'), 'utf8')).toBe('local-legacy')
  })

  it('skips with warning when project path is missing', () => {
    mkdirSync(join(repoPath, 'cursor', 'projects', 'gone'), { recursive: true })
    const lines: string[] = []
    const session = beginSnapshot(userDataDir, 'test')
    installCursorProject(
      repoPath,
      { name: 'gone', path: join(dir, 'does-not-exist') },
      session,
      (l) => lines.push(l.text),
    )
    session.commit()
    expect(lines.some((t) => t.includes('path missing'))).toBe(true)
  })

  it('skips with info when no synced data exists in repo', () => {
    const lines: string[] = []
    const session = beginSnapshot(userDataDir, 'test')
    installCursorProject(
      repoPath,
      { name: 'fresh', path: projectPath },
      session,
      (l) => lines.push(l.text),
    )
    session.commit()
    expect(lines.some((t) => t.includes('no synced data'))).toBe(true)
    expect(existsSync(join(projectPath, '.cursor'))).toBe(false)
  })

  it('preserves pre-existing file with different content in snapshot before overwrite', () => {
    const src = join(repoPath, 'cursor', 'projects', 'app')
    mkdirSync(join(src, 'rules'), { recursive: true })
    writeFileSync(join(src, 'rules', 'rule.mdc'), 'NEW-CONTENT')
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'rule.mdc'), 'OLD-CONTENT')

    installCursorProjects(repoPath, [{ name: 'app', path: projectPath }], userDataDir)

    const snapDir = join(userDataDir, 'safety-snapshots')
    const sessions = readdirSync(snapDir)
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    const manifest = JSON.parse(readFileSync(join(snapDir, sessions[0]!, 'manifest.json'), 'utf8'))
    const originals = manifest.entries.map((e: { original: string }) => e.original)
    expect(originals).toContain(join(projectPath, '.cursor', 'rules', 'rule.mdc'))
    const entry = manifest.entries.find((e: { original: string }) => e.original === join(projectPath, '.cursor', 'rules', 'rule.mdc'))
    expect(readFileSync(entry.stored, 'utf8')).toBe('OLD-CONTENT')
  })
})

describe('installCursorProjects', () => {
  it('installs each project independently', () => {
    const p1 = join(dir, 'p1'); mkdirSync(p1)
    const p2 = join(dir, 'p2'); mkdirSync(p2)
    const src1 = join(repoPath, 'cursor', 'projects', 'one')
    const src2 = join(repoPath, 'cursor', 'projects', 'two')
    mkdirSync(join(src1, 'rules'), { recursive: true })
    writeFileSync(join(src1, 'rules', 'r.md'), '1')
    mkdirSync(join(src2, 'rules'), { recursive: true })
    writeFileSync(join(src2, 'rules', 'r.md'), '2')

    installCursorProjects(repoPath, [
      { name: 'one', path: p1 },
      { name: 'two', path: p2 },
    ], userDataDir)

    expect(readFileSync(join(p1, '.cursor', 'rules', 'r.md'), 'utf8')).toBe('1')
    expect(readFileSync(join(p2, '.cursor', 'rules', 'r.md'), 'utf8')).toBe('2')
  })

  it('leaves destination files untouched when preserve fails (fail-closed)', () => {
    // Set up a repo with a file that will need overwriting
    const src = join(repoPath, 'cursor', 'projects', 'app')
    mkdirSync(join(src, 'rules'), { recursive: true })
    writeFileSync(join(src, 'rules', 'rule.mdc'), 'NEW-CONTENT')

    // Pre-existing destination file with different content
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'rule.mdc'), 'ORIGINAL')

    // Point userDataDir at an existing FILE so mkdirSync inside preserve() throws
    const fileAsDir = join(dir, 'blocker-file')
    writeFileSync(fileAsDir, 'i am a file, not a dir')

    const before = readFileSync(join(projectPath, '.cursor', 'rules', 'rule.mdc'), 'utf8')

    expect(() =>
      installCursorProjects(repoPath, [{ name: 'app', path: projectPath }], fileAsDir),
    ).toThrow()

    // Phase B threw before Phase C ran — destination must be unchanged
    const after = readFileSync(join(projectPath, '.cursor', 'rules', 'rule.mdc'), 'utf8')
    expect(after).toBe(before)
    expect(after).toBe('ORIGINAL')
  })
})
