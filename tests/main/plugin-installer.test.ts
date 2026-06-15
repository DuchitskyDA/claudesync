import { describe, it, expect } from 'vitest'
import type { PluginEntry } from '../../src/shared/api'
import {
  installArgs,
  uninstallArgs,
  marketplaceAddArgs,
  marketplaceReposFor,
  runPluginInstalls,
  type CmdRunner,
} from '../../src/main/plugin-installer'

function plugin(id: string, repo?: string): PluginEntry {
  return {
    id,
    name: id,
    description: '',
    ...(repo ? { marketplace: { id: id.split('@')[1]!, source: { source: 'github', repo } } } : {}),
  }
}

describe('argv builders', () => {
  it('install uses plugin@marketplace id + user scope', () => {
    expect(installArgs('superpowers@official')).toEqual([
      'plugin', 'install', 'superpowers@official', '--scope', 'user',
    ])
  })
  it('uninstall mirrors install', () => {
    expect(uninstallArgs('a@b')).toEqual(['plugin', 'uninstall', 'a@b', '--scope', 'user'])
  })
  it('marketplace add takes a repo', () => {
    expect(marketplaceAddArgs('obra/superpowers-marketplace')).toEqual([
      'plugin', 'marketplace', 'add', 'obra/superpowers-marketplace',
    ])
  })
})

describe('marketplaceReposFor', () => {
  it('dedups repos in first-seen order, skips plugins without a marketplace', () => {
    const repos = marketplaceReposFor([
      plugin('a@m1', 'org/m1'),
      plugin('b@m1', 'org/m1'),   // dup repo
      plugin('c@official'),       // no marketplace
      plugin('d@m2', 'org/m2'),
    ])
    expect(repos).toEqual(['org/m1', 'org/m2'])
  })
})

describe('runPluginInstalls', () => {
  function recorder(fail: Set<string> = new Set()): { calls: string[][]; runner: CmdRunner } {
    const calls: string[][] = []
    const runner: CmdRunner = async (_bin, args) => {
      calls.push(args)
      const id = args[2] // install/uninstall: id is args[2]
      const exitCode = id && fail.has(id) ? 1 : 0
      return { exitCode, stdout: '', stderr: exitCode ? 'boom' : '' }
    }
    return { calls, runner }
  }

  it('adds marketplaces first, then installs, in order', async () => {
    const { calls, runner } = recorder()
    const r = await runPluginInstalls('/bin/claude',
      [plugin('a@m1', 'org/m1'), plugin('b@m2', 'org/m2')], [], runner)
    expect(r.ok).toBe(true)
    expect(calls).toEqual([
      ['plugin', 'marketplace', 'add', 'org/m1'],
      ['plugin', 'marketplace', 'add', 'org/m2'],
      ['plugin', 'install', 'a@m1', '--scope', 'user'],
      ['plugin', 'install', 'b@m2', '--scope', 'user'],
    ])
  })

  it('uninstalls disabled ids', async () => {
    const { calls, runner } = recorder()
    const r = await runPluginInstalls('/bin/claude', [], ['x@m'], runner)
    expect(r.ok).toBe(true)
    expect(calls).toEqual([['plugin', 'uninstall', 'x@m', '--scope', 'user']])
  })

  it('collects per-id failures without aborting the rest', async () => {
    const { calls, runner } = recorder(new Set(['bad@m']))
    const r = await runPluginInstalls('/bin/claude',
      [plugin('good@m', 'org/m'), plugin('bad@m', 'org/m')], [], runner)
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('bad@m')
    // good@m still attempted
    expect(calls.some((c) => c[2] === 'good@m')).toBe(true)
  })
})
