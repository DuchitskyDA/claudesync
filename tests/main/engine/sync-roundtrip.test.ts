import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeConfig } from '@shared/api'
import {
  buildSourceFixture,
  initEmptyRepo,
  projectsFromFixture,
  roundTrip,
  type FixtureLayout,
} from '../../fixtures/sync-roundtrip'

const ALL_ON: ClaudeConfig['syncGlobal'] = {
  claudeMd: true,
  commands: true,
  skills: true,
  settings: true,
}

// These tests spawn git sub-processes and do real FS I/O.  30 s is generous
// but avoids flakiness on slow CI / Windows AV scan delays.
const T = 30_000

let root: string
let layout: FixtureLayout
let repoPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cs-rt-'))
  layout = buildSourceFixture(root, ['alpha', 'beta'])
  repoPath = join(root, 'repo')
  initEmptyRepo(repoPath)
})
afterEach(() => {
  // best-effort: Windows git object files can remain locked briefly after the
  // git process exits; silence any resulting EPERM rather than failing the run.
  try { rmSync(root, { recursive: true, force: true }) } catch { /* noop */ }
})

describe('sync round-trip — full ON', () => {
  it('source ≡ target byte-for-byte for synced files; service files absent on target', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout),
    })

    expect(r.targetHome.get('CLAUDE.md')).toBe(r.sourceHome.get('CLAUDE.md'))
    expect(r.targetHome.get('commands/cmd.md')).toBe(r.sourceHome.get('commands/cmd.md'))
    expect(r.targetHome.get('skills/sk1/SKILL.md')).toBe(r.sourceHome.get('skills/sk1/SKILL.md'))

    for (const p of layout.projects) {
      const memRel = `projects/${p.encoded}/memory/${p.name}.md`
      expect(r.targetHome.get(memRel)).toBe(r.sourceHome.get(memRel))
    }

    for (const p of layout.projects) {
      const src = r.sourceProjects.get(p.name)!
      const tgt = r.targetProjects.get(p.name)!
      expect(tgt.get('.claude/CLAUDE.md')).toBe(src.get('.claude/CLAUDE.md'))
      expect(tgt.get(`.claude/commands/${p.name}.md`)).toBe(src.get(`.claude/commands/${p.name}.md`))
      expect(tgt.get(`.claude/skills/s-${p.name}/SKILL.md`))
        .toBe(src.get(`.claude/skills/s-${p.name}/SKILL.md`))
    }

    expect(r.targetHome.has('plugins/p.json')).toBe(false)
    expect(r.targetHome.has('sessions/s.jsonl')).toBe(false)
    expect(r.targetHome.has('cache/c')).toBe(false)
    expect(r.targetHome.has('ide/i')).toBe(false)
    expect(r.targetHome.has('statsig/x')).toBe(false)
    expect(r.targetHome.has('history.jsonl')).toBe(false)
    expect(r.targetHome.has('.credentials.json')).toBe(false)
    expect(r.targetHome.has('settings.local.json')).toBe(false)
    expect(r.targetHome.has('CLAUDE.md.backup.20260101-120000')).toBe(false)
    for (const p of layout.projects) {
      const tgt = r.targetProjects.get(p.name)!
      expect(tgt.has('.claude/settings.local.json')).toBe(false)
      expect(tgt.has('.claude/.credentials.json')).toBe(false)
      expect(tgt.has('.claude/scheduled_tasks.lock')).toBe(false)
      expect(tgt.has('.claude/worktrees/wt1/x')).toBe(false)
      expect(r.targetHome.has(`projects/${p.encoded}/sessions/s.jsonl`)).toBe(false)
      expect(r.targetHome.has(`projects/${p.encoded}/foo.jsonl`)).toBe(false)
    }
  }, T)

  it('global settings.json: target has only whitelisted keys', async () => {
    await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout),
    })
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(join(root, 'target', 'home', '.claude', 'settings.json'), 'utf8')
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed.userID).toBeUndefined()
    expect(parsed.cachedFoo).toBeUndefined()
    expect(parsed.permissions).toEqual({ allow: ['Bash(ls)'] })
    expect(parsed.theme).toBe('dark')
  }, T)

  it('project .claude/settings.json: target has only whitelisted keys', async () => {
    await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout),
    })
    const { readFileSync } = await import('node:fs')
    for (const p of layout.projects) {
      const text = readFileSync(
        join(root, 'target', 'projects', p.name, '.claude', 'settings.json'),
        'utf8',
      )
      const parsed = JSON.parse(text) as Record<string, unknown>
      expect(parsed.userID).toBeUndefined()
      expect(parsed.permissions).toEqual({ allow: [`Bash(echo ${p.name})`] })
      expect(parsed.theme).toBe('light')
    }
  }, T)
})

describe('sync round-trip — selective toggles', () => {
  it('syncGlobal.commands=false: global commands absent in repo and target', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, commands: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('commands/cmd.md')).toBe(false)
    expect(r.targetHome.has('commands/cmd.md')).toBe(false)
    expect(r.targetHome.has('CLAUDE.md')).toBe(true)
    expect(r.targetHome.has('skills/sk1/SKILL.md')).toBe(true)
    expect(r.targetProjects.get('alpha')!.has('.claude/commands/alpha.md')).toBe(true)
  }, T)

  it('syncGlobal.claudeMd=false', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, claudeMd: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('CLAUDE.md')).toBe(false)
    expect(r.targetHome.has('CLAUDE.md')).toBe(false)
    expect(r.targetHome.has('commands/cmd.md')).toBe(true)
  }, T)

  it('syncGlobal.skills=false', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, skills: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('skills/sk1/SKILL.md')).toBe(false)
    expect(r.targetHome.has('skills/sk1/SKILL.md')).toBe(false)
  }, T)

  it('syncGlobal.settings=false', async () => {
    const r = await roundTrip({
      layout, repoPath,
      syncGlobal: { ...ALL_ON, settings: false },
      projects: projectsFromFixture(layout),
    })
    expect(r.repoClaude.has('settings.json')).toBe(false)
    expect(r.targetHome.has('settings.json')).toBe(false)
  }, T)

  it('project.syncMemory=false for alpha: alpha memory absent, beta memory present', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout, { alpha: { syncMemory: false } }),
    })
    const alpha = layout.projects.find((p) => p.name === 'alpha')!
    const beta = layout.projects.find((p) => p.name === 'beta')!
    expect(r.repoClaude.has(`projects/alpha/memory/alpha.md`)).toBe(false)
    expect(r.targetHome.has(`projects/${alpha.encoded}/memory/alpha.md`)).toBe(false)
    expect(r.targetHome.has(`projects/${beta.encoded}/memory/beta.md`)).toBe(true)
    expect(r.targetProjects.get('alpha')!.has('.claude/CLAUDE.md')).toBe(true)
  }, T)

  it('project.syncDotClaude=false for alpha: alpha .claude absent, memory present', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout, { alpha: { syncDotClaude: false } }),
    })
    const alpha = layout.projects.find((p) => p.name === 'alpha')!
    expect(r.repoClaude.has('projects/alpha/.claude/CLAUDE.md')).toBe(false)
    expect(r.targetProjects.get('alpha')!.has('.claude/CLAUDE.md')).toBe(false)
    expect(r.targetHome.has(`projects/${alpha.encoded}/memory/alpha.md`)).toBe(true)
    expect(r.targetProjects.get('beta')!.has('.claude/CLAUDE.md')).toBe(true)
  }, T)

  it('both per-project flags false for alpha: alpha completely absent in repo', async () => {
    const r = await roundTrip({
      layout, repoPath, syncGlobal: ALL_ON,
      projects: projectsFromFixture(layout, {
        alpha: { syncMemory: false, syncDotClaude: false },
      }),
    })
    expect(r.repoClaude.has('projects/alpha/.claude/CLAUDE.md')).toBe(false)
    expect(r.repoClaude.has('projects/alpha/memory/alpha.md')).toBe(false)
    expect(r.repoClaude.has('projects/beta/.claude/CLAUDE.md')).toBe(true)
  }, T)
})

describe('sync round-trip — service file invariant', () => {
  it('service files NEVER appear in repo regardless of toggle combo', async () => {
    const combos: ClaudeConfig['syncGlobal'][] = [
      ALL_ON,
      { claudeMd: false, commands: false, skills: false, settings: false },
      { ...ALL_ON, commands: false },
    ]
    for (const syncGlobal of combos) {
      const sub = mkdtempSync(join(tmpdir(), 'cs-rt-sub-'))
      try {
        const subLayout = buildSourceFixture(sub, ['only'])
        const subRepo = join(sub, 'repo')
        initEmptyRepo(subRepo)
        const r = await roundTrip({
          layout: subLayout, repoPath: subRepo, syncGlobal,
          projects: projectsFromFixture(subLayout),
        })
        for (const banned of [
          'plugins/p.json', 'sessions/s.jsonl', 'cache/c', 'ide/i', 'statsig/x',
          'history.jsonl', '.credentials.json', 'settings.local.json',
          'CLAUDE.md.backup.20260101-120000',
        ]) expect(r.repoClaude.has(banned)).toBe(false)
        const only = subLayout.projects[0]!
        expect(r.repoClaude.has(`projects/${only.encoded}/sessions/s.jsonl`)).toBe(false)
        expect(r.repoClaude.has(`projects/${only.encoded}/foo.jsonl`)).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/settings.local.json')).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/.credentials.json')).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/scheduled_tasks.lock')).toBe(false)
        expect(r.repoClaude.has('projects/only/.claude/worktrees/wt1/x')).toBe(false)
      } finally {
        try { rmSync(sub, { recursive: true, force: true }) } catch { /* noop */ }
      }
    }
  }, T * 3)
})
