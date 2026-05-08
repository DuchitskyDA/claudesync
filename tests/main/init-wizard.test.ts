import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanLocalConfig, generateGlobalStructure, dropTemplatesFrom } from '../../src/main/init-wizard'

let dir: string
let rulesTarget: string
let repoPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-init-'))
  rulesTarget = join(dir, 'claude')
  repoPath = join(dir, 'repo')
  mkdirSync(rulesTarget)
  mkdirSync(repoPath)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('scanLocalConfig', () => {
  it('lists CLAUDE.md, settings.json, commands, skills, projects/*/memory', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'rules')
    writeFileSync(join(rulesTarget, 'settings.json'), '{}')
    mkdirSync(join(rulesTarget, 'commands'))
    writeFileSync(join(rulesTarget, 'commands', 'foo.md'), 'cmd')
    mkdirSync(join(rulesTarget, 'skills', 'my-skill'), { recursive: true })
    writeFileSync(join(rulesTarget, 'skills', 'my-skill', 'SKILL.md'), 'skill')
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'memory', 'mem.md'), 'm')

    const r = scanLocalConfig(rulesTarget)
    expect(r.files).toContain('CLAUDE.md')
    expect(r.files).toContain('settings.json')
    expect(r.files).toContain('commands/foo.md')
    expect(r.files).toContain('skills/my-skill/SKILL.md')
    expect(r.files).toContain('projects/-p1/memory/mem.md')
  })

  it('excludes runtime artifacts', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'rules')
    mkdirSync(join(rulesTarget, 'sessions'))
    writeFileSync(join(rulesTarget, 'sessions', 's.jsonl'), '')
    writeFileSync(join(rulesTarget, 'history.jsonl'), '')
    mkdirSync(join(rulesTarget, 'cache'))
    writeFileSync(join(rulesTarget, 'cache', 'c'), '')
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'memory', 'mem.md'), 'm')
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'session.jsonl'), '')

    const r = scanLocalConfig(rulesTarget)
    expect(r.excluded.some((p) => p.includes('sessions'))).toBe(true)
    expect(r.excluded).toContain('history.jsonl')
    expect(r.excluded.some((p) => p.includes('cache'))).toBe(true)
    expect(r.excluded.some((p) => p.includes('session.jsonl'))).toBe(true)
    expect(r.files).toContain('projects/-p1/memory/mem.md')
    expect(r.files).not.toContain('projects/-p1/session.jsonl')
  })

  it('handles empty rulesTarget', () => {
    const r = scanLocalConfig(rulesTarget)
    expect(r.files).toEqual([])
    expect(r.totalSize).toBe(0)
  })

  it('computes totalSize', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'a'.repeat(100))
    writeFileSync(join(rulesTarget, 'settings.json'), '{}')
    const r = scanLocalConfig(rulesTarget)
    expect(r.totalSize).toBe(100 + 2)
  })

  it('handles non-existent rulesTarget without throwing', () => {
    const r = scanLocalConfig(join(dir, 'nope'))
    expect(r.files).toEqual([])
    expect(r.excluded).toEqual([])
    expect(r.totalSize).toBe(0)
  })
})

describe('generateGlobalStructure', () => {
  it('copies CLAUDE.md and commands into global/', () => {
    writeFileSync(join(rulesTarget, 'CLAUDE.md'), 'rules')
    mkdirSync(join(rulesTarget, 'commands'))
    writeFileSync(join(rulesTarget, 'commands', 'a.md'), 'A')

    generateGlobalStructure(rulesTarget, repoPath)

    expect(readFileSync(join(repoPath, 'global', 'CLAUDE.md'), 'utf8')).toBe('rules')
    expect(readFileSync(join(repoPath, 'global', 'commands', 'a.md'), 'utf8')).toBe('A')
  })

  it('strips env block from settings.json', () => {
    writeFileSync(
      join(rulesTarget, 'settings.json'),
      JSON.stringify({ env: { K: 'v' }, effortLevel: 'high' }),
    )
    generateGlobalStructure(rulesTarget, repoPath)
    const out = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(out.env).toBeUndefined()
    expect(out.effortLevel).toBe('high')
  })

  it('copies skills directory recursively', () => {
    mkdirSync(join(rulesTarget, 'skills', 's1'), { recursive: true })
    writeFileSync(join(rulesTarget, 'skills', 's1', 'SKILL.md'), 'X')
    generateGlobalStructure(rulesTarget, repoPath)
    expect(readFileSync(join(repoPath, 'global', 'skills', 's1', 'SKILL.md'), 'utf8')).toBe('X')
  })

  it('copies only memory dirs from projects/, skips sessions/jsonl', () => {
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'memory'), { recursive: true })
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'memory', 'm.md'), 'M')
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'session.jsonl'), 's')
    mkdirSync(join(rulesTarget, 'projects', '-p1', 'sessions'))
    writeFileSync(join(rulesTarget, 'projects', '-p1', 'sessions', 'a.jsonl'), 's')

    generateGlobalStructure(rulesTarget, repoPath)
    expect(
      readFileSync(join(repoPath, 'global', 'projects', '-p1', 'memory', 'm.md'), 'utf8'),
    ).toBe('M')
    expect(existsSync(join(repoPath, 'global', 'projects', '-p1', 'session.jsonl'))).toBe(false)
    expect(existsSync(join(repoPath, 'global', 'projects', '-p1', 'sessions'))).toBe(false)
  })

  it('handles missing source files gracefully', () => {
    expect(() => generateGlobalStructure(rulesTarget, repoPath)).not.toThrow()
    expect(existsSync(join(repoPath, 'global'))).toBe(true)
  })

  it('handles invalid settings.json by writing empty object minus env', () => {
    writeFileSync(join(rulesTarget, 'settings.json'), '{not json')
    expect(() => generateGlobalStructure(rulesTarget, repoPath)).not.toThrow()
    const out = JSON.parse(readFileSync(join(repoPath, 'global', 'settings.json'), 'utf8'))
    expect(out).toEqual({})
  })
})

describe('dropTemplatesFrom', () => {
  it('writes install.sh, install.ps1, README, LICENSE, .gitignore with substitutions', () => {
    const tplDir = join(dir, 'templates-fake')
    mkdirSync(tplDir, { recursive: true })
    writeFileSync(join(tplDir, 'install.sh.template'), '#!/usr/bin/env bash\n# {{name}}\n')
    writeFileSync(join(tplDir, 'install.ps1.template'), '# {{name}} on Windows')
    writeFileSync(join(tplDir, 'README.md.template'), '# {{name}}\nby {{owner}}')
    writeFileSync(join(tplDir, 'LICENSE.template'), 'MIT {{year}} {{owner}}')
    writeFileSync(join(tplDir, 'gitignore.template'), 'node_modules\n')

    dropTemplatesFrom(tplDir, repoPath, { name: 'my-repo', owner: 'dan' })

    expect(readFileSync(join(repoPath, 'install.sh'), 'utf8')).toBe('#!/usr/bin/env bash\n# my-repo\n')
    expect(readFileSync(join(repoPath, 'install.ps1'), 'utf8')).toBe('# my-repo on Windows')
    expect(readFileSync(join(repoPath, 'README.md'), 'utf8')).toBe('# my-repo\nby dan')
    expect(readFileSync(join(repoPath, 'LICENSE'), 'utf8')).toMatch(/MIT \d{4} dan/)
    expect(readFileSync(join(repoPath, '.gitignore'), 'utf8')).toBe('node_modules\n')
  })

  it('skips missing template files without error', () => {
    const tplDir = join(dir, 'empty')
    mkdirSync(tplDir)
    expect(() => dropTemplatesFrom(tplDir, repoPath, { name: 'x', owner: 'y' })).not.toThrow()
  })

  it('substitutes {{year}} with current year', () => {
    const tplDir = join(dir, 'tpl')
    mkdirSync(tplDir)
    writeFileSync(join(tplDir, 'LICENSE.template'), 'year={{year}}')
    dropTemplatesFrom(tplDir, repoPath, { name: 'r', owner: 'o' })
    const out = readFileSync(join(repoPath, 'LICENSE'), 'utf8')
    expect(out).toMatch(/^year=\d{4}$/)
  })
})
