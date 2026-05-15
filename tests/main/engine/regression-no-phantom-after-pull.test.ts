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
        repoPath, claudePath, cursorProjects: [], token: null, doFetch: false,
      })
      expect(s.localChanges).toBe(0)
      expect(s.state).toBe('in-sync')
    }
  })

  it('windows-only project hash dirs do NOT show as untracked when not in HEAD', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'shared rules\n')
    writeFileSync(
      join(claudePath, 'settings.json'),
      '{"permissions":{"allow":["x"]}}',
    )
    // Windows-only project memory
    mkdirSync(join(claudePath, 'projects', 'win-hash', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'win-hash', 'memory', 'note.md'), 'local note\n')

    const s = await refreshStatus({
      repoPath, claudePath, cursorProjects: [], token: null, doFetch: false,
    })
    // It IS a local change (added) — that's correct semantics now: user has unpushed memory.
    // But chip says "1 local-change", not 1+ untracked artifacts from background export.
    expect(s.localChanges).toBe(1)
    const added = s.diffs.find((d) => d.repoPath === 'claude/projects/win-hash/memory/note.md')
    expect(added?.status).toBe('added')
  })
})
