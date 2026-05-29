// tests/main/engine/regression-no-phantom-after-pull.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { refreshStatus } from '../../../src/main/sync/engine/engine'

let dir: string
let claudePath: string
let repoPath: string

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-noph-'))
  claudePath = join(dir, '.claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath)
  mkdirSync(repoPath)
  git(repoPath, ['init', '-q', '-b', 'main'])
  git(repoPath, ['config', 'user.email', 't@t'])
  git(repoPath, ['config', 'user.name', 't'])
  git(repoPath, ['config', 'core.autocrlf', 'false'])
  // First commit — "what Mac pushed": canonical settings.json + CLAUDE.md
  mkdirSync(join(repoPath, 'claude'))
  writeFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'shared rules\n')
  writeFileSync(
    join(repoPath, 'claude', 'settings.json'),
    '{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}',
  )
  git(repoPath, ['add', '-A'])
  git(repoPath, ['commit', '-q', '-m', 'mac push'])
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('no phantom diff after pull', () => {
  it('refreshStatus returns in-sync when source equals HEAD (canonical)', async () => {
    // simulate "after pull": source contains exactly what HEAD has, plus Claude's volatile numStartups
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'shared rules\n')
    writeFileSync(
      join(claudePath, 'settings.json'),
      '{"permissions":{"allow":["x"]},"numStartups":42,"env":{"SECRET":"k"}}',
    )

    // run 20 status refreshes — none should produce phantom diff
    for (let i = 0; i < 20; i++) {
      const s = await refreshStatus({
        repoPath, claudePath, claudeProjects: [], cursorProjects: [], token: null, doFetch: false,
        syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
      })
      expect(s.localChanges).toBe(0)
      expect(s.state).toBe('in-sync')
    }
  })

  it('HEAD entry for a registered project matches local <encoded>/memory after pull (no phantom)', async () => {
    // Simulate "after pull": HEAD already has claude/projects/myproj/memory/note.md
    // (because the other machine pushed it under the canonical <name>). Locally
    // the same content lives under projects/<encoded>/memory/note.md. With the
    // project registered, refreshStatus must consider them identical — no
    // phantom "added" on source side, no phantom "deleted" on HEAD side.
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'shared rules\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"permissions":{"allow":["x"]}}')
    mkdirSync(join(repoPath, 'claude', 'projects', 'myproj', 'memory'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'projects', 'myproj', 'memory', 'note.md'), 'shared note\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-q', '-m', 'add memory'])

    mkdirSync(join(claudePath, 'projects', 'enc-seg', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'enc-seg', 'memory', 'note.md'), 'shared note\n')

    const s = await refreshStatus({
      repoPath, claudePath,
      claudeProjects: [{ name: 'myproj', path: 'enc-seg', syncMemory: true, syncDotClaude: false }],
      cursorProjects: [], token: null, doFetch: false,
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    })
    expect(s.localChanges).toBe(0)
    expect(s.state).toBe('in-sync')
  })

  it('HEAD entries for an unregistered project are filtered out (no phantom delete)', async () => {
    // HEAD has claude/projects/otherproj/memory/x.md but the local user never
    // registered "otherproj". Without filtering, comparator would see this as
    // "deleted on source" — but we must skip silently (data belongs to a
    // device the user hasn't opted into).
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'shared rules\n')
    writeFileSync(join(claudePath, 'settings.json'), '{"permissions":{"allow":["x"]}}')
    mkdirSync(join(repoPath, 'claude', 'projects', 'otherproj', 'memory'), { recursive: true })
    writeFileSync(join(repoPath, 'claude', 'projects', 'otherproj', 'memory', 'note.md'), 'other\n')
    git(repoPath, ['add', '-A'])
    git(repoPath, ['commit', '-q', '-m', 'add unregistered memory'])

    const s = await refreshStatus({
      repoPath, claudePath,
      claudeProjects: [],
      cursorProjects: [], token: null, doFetch: false,
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    })
    const phantom = s.diffs.find((d) => d.repoPath.includes('otherproj'))
    expect(phantom).toBeUndefined()
    expect(s.state).toBe('in-sync')
  })

  it('windows-only project hash dirs do NOT show as untracked when not in HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'shared rules\n')
    writeFileSync(
      join(claudePath, 'settings.json'),
      '{"permissions":{"allow":["x"]}}',
    )
    // Windows-only project memory; register it under canonical name 'winproj'
    // so it lands at claude/projects/winproj/memory/... in the repo.
    mkdirSync(join(claudePath, 'projects', 'win-hash', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'win-hash', 'memory', 'note.md'), 'local note\n')

    const s = await refreshStatus({
      repoPath, claudePath,
      claudeProjects: [{ name: 'winproj', path: 'win-hash', syncMemory: true, syncDotClaude: false }],
      cursorProjects: [], token: null, doFetch: false,
      syncGlobal: { claudeMd: true, commands: true, skills: true, settings: true },
    })
    // One local change (added) — user has unpushed memory under the canonical
    // repo path.
    expect(s.localChanges).toBe(1)
    const added = s.diffs.find((d) => d.repoPath === 'claude/projects/winproj/memory/note.md')
    expect(added?.status).toBe('added')
  })
})
