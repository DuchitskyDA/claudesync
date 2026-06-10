import { describe, it, expect } from 'vitest'
import { classifyRepoPath, type MembershipCtx } from '../../../src/main/sync/engine/path-membership'
import { encodeClaudeProjectSegment } from '../../../src/main/sync/engine/rules'

const allOn = { claudeMd: true, commands: true, skills: true, settings: true }
const ctx: MembershipCtx = {
  claudeProjects: [
    { name: 'erp', path: 'C:\\work\\erp', syncMemory: true, syncDotClaude: true },
    { name: 'web', path: 'C:\\work\\web', syncMemory: false, syncDotClaude: false },
  ],
  cursorProjects: [{ name: 'cur1', path: 'C:\\work\\cur1' }],
  syncGlobal: allOn,
}

describe('classifyRepoPath', () => {
  it.each([
    ['claude/CLAUDE.md', 'claude-global', 'CLAUDE.md'],
    ['claude/settings.json', 'claude-global', 'settings.json'],
    ['claude/commands/x.md', 'claude-global', 'commands/x.md'],
    ['claude/skills/s/SKILL.md', 'claude-global', 'skills/s/SKILL.md'],
  ])('%s → ok %s', (repoPath, kind, surfacePath) => {
    const c = classifyRepoPath(repoPath, ctx)
    expect(c).toEqual({ ok: { source: { kind }, surfacePath } })
  })

  it('global toggles → toggle-off', () => {
    const off = { ...ctx, syncGlobal: { ...allOn, commands: false } }
    expect(classifyRepoPath('claude/commands/x.md', off)).toEqual({ skip: 'toggle-off' })
  })

  it('unknown path under claude/ → unknown-path (К4)', () => {
    expect(classifyRepoPath('claude/unknown.txt', ctx)).toEqual({ skip: 'unknown-path' })
    expect(classifyRepoPath('claude/agents/a.md', ctx)).toEqual({ skip: 'unknown-path' })
    expect(classifyRepoPath('claude/projects/erp/sessions/s.jsonl', ctx)).toEqual({ skip: 'unknown-path' })
  })

  it('project memory: registered+on → ok with encoded surfacePath', () => {
    const c = classifyRepoPath('claude/projects/erp/memory/m.md', ctx)
    expect(c).toEqual({
      ok: {
        source: { kind: 'claude-project-memory', projectName: 'erp' },
        surfacePath: `projects/${encodeClaudeProjectSegment('C:\\work\\erp')}/memory/m.md`,
      },
    })
  })

  it('project memory: toggle off → toggle-off; unregistered → unregistered-project', () => {
    expect(classifyRepoPath('claude/projects/web/memory/m.md', ctx)).toEqual({ skip: 'toggle-off' })
    expect(classifyRepoPath('claude/projects/ghost/memory/m.md', ctx)).toEqual({ skip: 'unregistered-project' })
  })

  it('project .claude: registered+on → ok', () => {
    expect(classifyRepoPath('claude/projects/erp/.claude/CLAUDE.md', ctx)).toEqual({
      ok: { source: { kind: 'claude-project-dotclaude', projectName: 'erp' }, surfacePath: '.claude/CLAUDE.md' },
    })
    expect(classifyRepoPath('claude/projects/web/.claude/CLAUDE.md', ctx)).toEqual({ skip: 'toggle-off' })
  })

  it('cursor: registered → ok, unregistered → unregistered-project', () => {
    expect(classifyRepoPath('cursor/projects/cur1/.cursorrules', ctx)).toEqual({
      ok: { source: { kind: 'cursor-project', projectName: 'cur1' }, surfacePath: '.cursorrules' },
    })
    expect(classifyRepoPath('cursor/projects/nope/.cursorrules', ctx)).toEqual({ skip: 'unregistered-project' })
  })

  it('paths outside claude/cursor → unknown-path', () => {
    expect(classifyRepoPath('README.md', ctx)).toEqual({ skip: 'unknown-path' })
  })
})
