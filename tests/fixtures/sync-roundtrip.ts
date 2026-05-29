import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { ClaudeConfig, ClaudeProject } from '@shared/api'
import {
  enumClaudeSource,
  enumClaudeProjectDotClaudeSource,
} from '../../src/main/sync/engine/source-enum'
import { encodeClaudeProjectSegment } from '../../src/main/sync/engine/rules'
import { buildAndCommitFromSource } from '../../src/main/sync/engine/index-builder'
import { catFileBlob } from '../../src/main/sync/engine/git-ops'
import { mergeSettingsForPull, applyToSource } from '../../src/main/sync/engine/pull-apply'
import { canonicalizeSettings } from '../../src/main/sync/engine/settings-canonical'

/** A tree of files: path (posix-relative) → sha256 of bytes. */
export type Tree = Map<string, string>

export function sha256File(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

export function snapshotTree(rootAbs: string): Tree {
  const tree: Tree = new Map()
  if (!existsSync(rootAbs)) return tree
  const stack: string[] = [rootAbs]
  while (stack.length) {
    const cur = stack.pop()!
    for (const name of readdirSync(cur)) {
      const abs = join(cur, name)
      const st = statSync(abs)
      if (st.isDirectory()) stack.push(abs)
      else if (st.isFile()) {
        const rel = relative(rootAbs, abs).split(sep).join(posix.sep)
        tree.set(rel, sha256File(abs))
      }
    }
  }
  return tree
}

export type FixtureProject = {
  name: string
  path: string
  encoded: string
}

export type FixtureLayout = {
  root: string
  home: string
  projects: FixtureProject[]
}

/** Build a realistic source fixture under `root` */
export function buildSourceFixture(root: string, projectNames: string[]): FixtureLayout {
  mkdirSync(root, { recursive: true })
  const home = join(root, 'home', '.claude')
  mkdirSync(home, { recursive: true })
  // Global synced
  writeFileSync(join(home, 'CLAUDE.md'), 'global rules\n')
  writeFileSync(
    join(home, 'settings.json'),
    JSON.stringify(
      {
        permissions: { allow: ['Bash(ls)'] },
        userID: 'SECRET-userid-should-not-sync',
        cachedFoo: 42,
        theme: 'dark',
      },
      null,
      2,
    ),
  )
  mkdirSync(join(home, 'commands'), { recursive: true })
  writeFileSync(join(home, 'commands', 'cmd.md'), 'global cmd\n')
  mkdirSync(join(home, 'skills', 'sk1'), { recursive: true })
  writeFileSync(join(home, 'skills', 'sk1', 'SKILL.md'), 'global skill\n')
  // Global service files (must never sync)
  mkdirSync(join(home, 'plugins'), { recursive: true })
  mkdirSync(join(home, 'sessions'), { recursive: true })
  mkdirSync(join(home, 'cache'), { recursive: true })
  mkdirSync(join(home, 'ide'), { recursive: true })
  mkdirSync(join(home, 'statsig'), { recursive: true })
  writeFileSync(join(home, 'plugins', 'p.json'), 'P')
  writeFileSync(join(home, 'sessions', 's.jsonl'), 'S')
  writeFileSync(join(home, 'cache', 'c'), 'C')
  writeFileSync(join(home, 'ide', 'i'), 'I')
  writeFileSync(join(home, 'statsig', 'x'), 'X')
  writeFileSync(join(home, 'history.jsonl'), 'H')
  writeFileSync(join(home, '.credentials.json'), 'CREDS')
  writeFileSync(join(home, 'settings.local.json'), '{"local": true}')
  writeFileSync(join(home, 'CLAUDE.md.backup.20260101-120000'), 'backup')

  const projects: FixtureProject[] = []
  for (const name of projectNames) {
    const projPath = join(root, 'projects', name)
    mkdirSync(projPath, { recursive: true })
    const dot = join(projPath, '.claude')
    mkdirSync(dot, { recursive: true })
    writeFileSync(join(dot, 'CLAUDE.md'), `proj ${name} rules\n`)
    writeFileSync(
      join(dot, 'settings.json'),
      JSON.stringify(
        {
          permissions: { allow: [`Bash(echo ${name})`] },
          userID: `secret-${name}`,
          theme: 'light',
        },
        null,
        2,
      ),
    )
    mkdirSync(join(dot, 'commands'), { recursive: true })
    writeFileSync(join(dot, 'commands', `${name}.md`), `cmd for ${name}\n`)
    mkdirSync(join(dot, 'skills', `s-${name}`), { recursive: true })
    writeFileSync(join(dot, 'skills', `s-${name}`, 'SKILL.md'), `skill for ${name}\n`)
    // Service files (must never sync)
    writeFileSync(join(dot, 'settings.local.json'), '{}')
    writeFileSync(join(dot, '.credentials.json'), 'PROJ-CREDS')
    writeFileSync(join(dot, 'scheduled_tasks.lock'), 'lock')
    mkdirSync(join(dot, 'worktrees', 'wt1'), { recursive: true })
    writeFileSync(join(dot, 'worktrees', 'wt1', 'x'), 'WT')
    // Memory under ~/.claude/projects/<encoded>/
    const encoded = encodeClaudeProjectSegment(projPath)
    mkdirSync(join(home, 'projects', encoded, 'memory'), { recursive: true })
    writeFileSync(join(home, 'projects', encoded, 'memory', `${name}.md`), `mem for ${name}\n`)
    mkdirSync(join(home, 'projects', encoded, 'sessions'), { recursive: true })
    writeFileSync(join(home, 'projects', encoded, 'sessions', 's.jsonl'), 'SESS')
    writeFileSync(join(home, 'projects', encoded, 'foo.jsonl'), 'FOO')

    projects.push({ name, path: projPath, encoded })
  }
  return { root, home, projects }
}

/** Initialise an empty git repo at `repoPath` with one empty commit on main. */
export function initEmptyRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true })
  const run = (args: string[]): void => {
    const r = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
  run(['init', '-b', 'main'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  run(['commit', '--allow-empty', '-m', 'init'])
}

/** Build claude project descriptors from a fixture, with toggle overrides. */
export function projectsFromFixture(
  layout: FixtureLayout,
  overrides: Partial<Record<string, Partial<Pick<ClaudeProject, 'syncMemory' | 'syncDotClaude'>>>> = {},
): ClaudeProject[] {
  return layout.projects.map((p) => ({
    name: p.name,
    path: p.path,
    syncMemory: overrides[p.name]?.syncMemory ?? true,
    syncDotClaude: overrides[p.name]?.syncDotClaude ?? true,
  }))
}

export type RoundTripConfig = {
  layout: FixtureLayout
  repoPath: string
  syncGlobal: ClaudeConfig['syncGlobal']
  projects: ClaudeProject[]
}

export type RoundTripResult = {
  sourceHome: Tree
  sourceProjects: Map<string, Tree>
  repoClaude: Tree
  targetHome: Tree
  targetProjects: Map<string, Tree>
}

/** Push all enabled surfaces, then mirror back to a fresh target. */
export async function roundTrip(cfg: RoundTripConfig): Promise<RoundTripResult> {
  // 1. Snapshot source.
  const sourceHome = snapshotTree(cfg.layout.home)
  const sourceProjects = new Map<string, Tree>()
  for (const p of cfg.layout.projects) sourceProjects.set(p.name, snapshotTree(p.path))

  // 2. Enumerate.
  const globalRes = await enumClaudeSource(cfg.layout.home, cfg.projects, cfg.syncGlobal)
  const dotResults = await Promise.all(
    cfg.projects.filter((p) => p.syncDotClaude).map((p) => enumClaudeProjectDotClaudeSource(p.path, p.name)),
  )
  const allEntries = [...globalRes.entries, ...dotResults.flatMap((r) => r.entries)]

  // 3. Build "diffs" for buildAndCommitFromSource (all "added" since repo's claude/ is empty).
  const diffs = allEntries.map((e) => ({
    source: { kind: 'claude-global' as const },
    repoPath: e.repoPath,
    surfacePath: e.surfacePath,
    status: 'added' as const,
    sourceSha: e.sha1,
  }))

  await buildAndCommitFromSource({
    repoPath: cfg.repoPath,
    diffs,
    sourceContent: (d) => {
      if (d.surfacePath.startsWith('.claude/')) {
        const m = d.repoPath.match(/^claude\/projects\/([^/]+)\/\.claude\//)
        if (!m) return null
        const proj = cfg.projects.find((p) => p.name === m[1])
        if (!proj) return null
        const abs = join(proj.path, d.surfacePath)
        if (d.surfacePath === '.claude/settings.json') {
          return canonicalizeSettings(readFileSync(abs))
        }
        return readFileSync(abs)
      }
      const abs = join(cfg.layout.home, d.surfacePath)
      if (d.surfacePath === 'settings.json') {
        return canonicalizeSettings(readFileSync(abs))
      }
      return readFileSync(abs)
    },
    commitMessage: 'round-trip push',
    indexFile: join(cfg.repoPath, '.git', `tmp-index-${process.pid}-${Date.now()}`),
  })

  const repoClaude = snapshotTree(join(cfg.repoPath, 'claude'))

  // 4. Create a clean target.
  const targetRoot = join(cfg.layout.root, 'target')
  const targetHome = join(targetRoot, 'home', '.claude')
  mkdirSync(targetHome, { recursive: true })
  const targetProjectsByName = new Map<string, string>()
  for (const p of cfg.layout.projects) {
    const tp = join(targetRoot, 'projects', p.name)
    mkdirSync(tp, { recursive: true })
    targetProjectsByName.set(p.name, tp)
  }

  // 5. Apply.
  for (const entry of allEntries) {
    const blob = await catFileBlob(cfg.repoPath, entry.sha1)
    if (entry.surfacePath.startsWith('.claude/')) {
      const m = entry.repoPath.match(/^claude\/projects\/([^/]+)\/\.claude\//)
      if (!m) continue
      const tp = targetProjectsByName.get(m[1]!)
      if (!tp) continue
      let toWrite = blob
      if (entry.surfacePath === '.claude/settings.json') {
        toWrite = mergeSettingsForPull(blob, null)
      }
      await applyToSource(join(tp, entry.surfacePath), toWrite)
    } else {
      let toWrite = blob
      if (entry.surfacePath === 'settings.json') {
        toWrite = mergeSettingsForPull(blob, null)
      }
      await applyToSource(join(targetHome, entry.surfacePath), toWrite)
    }
  }

  // 6. Snapshot.
  const tgtHome = snapshotTree(targetHome)
  const tgtProjects = new Map<string, Tree>()
  for (const p of cfg.layout.projects) {
    const tp = targetProjectsByName.get(p.name)!
    tgtProjects.set(p.name, snapshotTree(tp))
  }

  return {
    sourceHome,
    sourceProjects,
    repoClaude,
    targetHome: tgtHome,
    targetProjects: tgtProjects,
  }
}
