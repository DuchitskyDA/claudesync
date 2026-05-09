import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCursorProject, installCursorProjects } from '../../src/main/sync/cursor-install'

let dir: string
let repoPath: string
let projectPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-ci-'))
  repoPath = join(dir, 'repo')
  projectPath = join(dir, 'app')
  mkdirSync(repoPath, { recursive: true })
  mkdirSync(projectPath, { recursive: true })
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

    installCursorProject(repoPath, { name: 'app', path: projectPath })

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

    installCursorProject(repoPath, { name: 'app', path: projectPath })

    expect(readFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'utf8')).toBe('NEW')
    // No .backup files anywhere
    const after = (path: string) => (existsSync(path) ? readdirSync(path) : [])
    expect(after(join(projectPath, '.cursor', 'rules')).filter((n) => n.includes('.backup'))).toEqual([])
  })

  it('removes files in destination that are absent in source', () => {
    const src = join(repoPath, 'cursor', 'projects', 'app')
    mkdirSync(join(src, 'rules'), { recursive: true })
    writeFileSync(join(src, 'rules', 'keep.mdc'), 'K')

    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'keep.mdc'), 'OLD')
    writeFileSync(join(projectPath, '.cursor', 'rules', 'gone.mdc'), 'X')

    installCursorProject(repoPath, { name: 'app', path: projectPath })

    expect(existsSync(join(projectPath, '.cursor', 'rules', 'keep.mdc'))).toBe(true)
    expect(existsSync(join(projectPath, '.cursor', 'rules', 'gone.mdc'))).toBe(false)
  })

  it('removes legacy .cursorrules from project when source no longer has it', () => {
    mkdirSync(join(repoPath, 'cursor', 'projects', 'app'), { recursive: true })
    writeFileSync(join(projectPath, '.cursorrules'), 'old')

    installCursorProject(repoPath, { name: 'app', path: projectPath })

    expect(existsSync(join(projectPath, '.cursorrules'))).toBe(false)
  })

  it('skips with warning when project path is missing', () => {
    mkdirSync(join(repoPath, 'cursor', 'projects', 'gone'), { recursive: true })
    const lines: string[] = []
    installCursorProject(
      repoPath,
      { name: 'gone', path: join(dir, 'does-not-exist') },
      (l) => lines.push(l.text),
    )
    expect(lines.some((t) => t.includes('path missing'))).toBe(true)
  })

  it('skips with info when no synced data exists in repo', () => {
    const lines: string[] = []
    installCursorProject(
      repoPath,
      { name: 'fresh', path: projectPath },
      (l) => lines.push(l.text),
    )
    expect(lines.some((t) => t.includes('no synced data'))).toBe(true)
    expect(existsSync(join(projectPath, '.cursor'))).toBe(false)
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
    ])

    expect(readFileSync(join(p1, '.cursor', 'rules', 'r.md'), 'utf8')).toBe('1')
    expect(readFileSync(join(p2, '.cursor', 'rules', 'r.md'), 'utf8')).toBe('2')
  })
})
