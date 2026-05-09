import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportCursorProject, exportCursorProjects } from '../../src/main/sync/cursor'

let dir: string
let projectPath: string
let repoPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-cur-'))
  projectPath = join(dir, 'app')
  repoPath = join(dir, 'repo')
  mkdirSync(projectPath, { recursive: true })
  mkdirSync(repoPath, { recursive: true })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('exportCursorProject', () => {
  it('mirrors .cursor/rules and .cursor/skills, copies .cursorrules', () => {
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'R')
    mkdirSync(join(projectPath, '.cursor', 'skills', 'sk'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'skills', 'sk', 'SKILL.md'), 'S')
    writeFileSync(join(projectPath, '.cursorrules'), 'legacy')

    exportCursorProject({ name: 'app', path: projectPath }, repoPath)

    const dest = join(repoPath, 'cursor', 'projects', 'app')
    expect(readFileSync(join(dest, 'rules', 'a.mdc'), 'utf8')).toBe('R')
    expect(readFileSync(join(dest, 'skills', 'sk', 'SKILL.md'), 'utf8')).toBe('S')
    expect(readFileSync(join(dest, '.cursorrules'), 'utf8')).toBe('legacy')
  })

  it('removes files from destination that are no longer in source on second push', () => {
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'A')
    writeFileSync(join(projectPath, '.cursor', 'rules', 'b.mdc'), 'B')
    exportCursorProject({ name: 'app', path: projectPath }, repoPath)

    rmSync(join(projectPath, '.cursor', 'rules', 'b.mdc'))
    exportCursorProject({ name: 'app', path: projectPath }, repoPath)

    const destRules = join(repoPath, 'cursor', 'projects', 'app', 'rules')
    expect(existsSync(join(destRules, 'a.mdc'))).toBe(true)
    expect(existsSync(join(destRules, 'b.mdc'))).toBe(false)
  })

  it('removes legacy .cursorrules from destination when source disappears', () => {
    writeFileSync(join(projectPath, '.cursorrules'), 'old')
    exportCursorProject({ name: 'app', path: projectPath }, repoPath)
    rmSync(join(projectPath, '.cursorrules'))
    exportCursorProject({ name: 'app', path: projectPath }, repoPath)
    expect(existsSync(join(repoPath, 'cursor', 'projects', 'app', '.cursorrules'))).toBe(false)
  })

  it('skips and emits warning when project path is missing, leaves existing dest intact', () => {
    mkdirSync(join(repoPath, 'cursor', 'projects', 'gone'), { recursive: true })
    writeFileSync(join(repoPath, 'cursor', 'projects', 'gone', 'preserved.txt'), 'old')
    const lines: string[] = []

    exportCursorProject(
      { name: 'gone', path: join(dir, 'does-not-exist') },
      repoPath,
      (l) => lines.push(l.text),
    )

    expect(existsSync(join(repoPath, 'cursor', 'projects', 'gone', 'preserved.txt'))).toBe(true)
    expect(lines.some((t) => t.includes('gone'))).toBe(true)
  })

  it('ignores .DS_Store and Thumbs.db', () => {
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(projectPath, '.cursor', 'rules', 'a.mdc'), 'A')
    writeFileSync(join(projectPath, '.cursor', 'rules', '.DS_Store'), 'mac')
    writeFileSync(join(projectPath, '.cursor', 'rules', 'Thumbs.db'), 'win')

    exportCursorProject({ name: 'app', path: projectPath }, repoPath)

    const destRules = join(repoPath, 'cursor', 'projects', 'app', 'rules')
    expect(existsSync(join(destRules, 'a.mdc'))).toBe(true)
    expect(existsSync(join(destRules, '.DS_Store'))).toBe(false)
    expect(existsSync(join(destRules, 'Thumbs.db'))).toBe(false)
  })
})

describe('exportCursorProjects', () => {
  it('exports each project under its own subdir', () => {
    const p1 = join(dir, 'p1')
    mkdirSync(join(p1, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(p1, '.cursor', 'rules', 'r.md'), '1')
    const p2 = join(dir, 'p2')
    mkdirSync(join(p2, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(p2, '.cursor', 'rules', 'r.md'), '2')

    exportCursorProjects(
      [
        { name: 'one', path: p1 },
        { name: 'two', path: p2 },
      ],
      repoPath,
    )

    expect(
      readFileSync(join(repoPath, 'cursor', 'projects', 'one', 'rules', 'r.md'), 'utf8'),
    ).toBe('1')
    expect(
      readFileSync(join(repoPath, 'cursor', 'projects', 'two', 'rules', 'r.md'), 'utf8'),
    ).toBe('2')
  })
})
