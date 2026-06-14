import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isInstallNeeded } from '../../src/main/install-check'

function makeRepoWithSkill() {
  const base = mkdtempSync(join(tmpdir(), 'cs-install-'))
  const repo = join(base, 'repo')
  const target = join(base, 'claude')
  mkdirSync(join(repo, 'claude', 'skills', 'foo'), { recursive: true })
  writeFileSync(join(repo, 'claude', 'skills', 'foo', 'SKILL.md'), 'x')
  mkdirSync(target, { recursive: true })
  return { base, repo, target }
}

const claudeOnly = (repo: string, target: string) => ({
  repoPath: repo,
  claudeEnabled: true,
  claudePath: target,
  cursorEnabled: false,
  cursorProjects: [] as { name: string; path: string }[],
})

describe('isInstallNeeded', () => {
  it('true when the repo has a skill the target lacks', () => {
    const { base, repo, target } = makeRepoWithSkill()
    expect(isInstallNeeded(claudeOnly(repo, target))).toBe(true)
    rmSync(base, { recursive: true, force: true })
  })

  it('false when the target already has the repo content', () => {
    const { base, repo, target } = makeRepoWithSkill()
    mkdirSync(join(target, 'skills', 'foo'), { recursive: true })
    writeFileSync(join(target, 'skills', 'foo', 'SKILL.md'), 'x')
    expect(isInstallNeeded(claudeOnly(repo, target))).toBe(false)
    rmSync(base, { recursive: true, force: true })
  })

  it('false when the repo claude dir is empty (only .gitkeep)', () => {
    const base = mkdtempSync(join(tmpdir(), 'cs-install-'))
    const repo = join(base, 'repo')
    const target = join(base, 'claude')
    mkdirSync(join(repo, 'claude'), { recursive: true })
    writeFileSync(join(repo, 'claude', '.gitkeep'), '')
    mkdirSync(target, { recursive: true })
    expect(isInstallNeeded(claudeOnly(repo, target))).toBe(false)
    rmSync(base, { recursive: true, force: true })
  })

  it('false when there is no repo path', () => {
    expect(isInstallNeeded({ repoPath: null, claudeEnabled: true, claudePath: '/x', cursorEnabled: false, cursorProjects: [] })).toBe(false)
  })
})
