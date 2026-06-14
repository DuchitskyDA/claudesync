import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseRepoUrl,
  normalizeRepoUrl,
  findExistingClones,
  cloneRepo,
} from '../../src/main/git-clone'

describe('parseRepoUrl', () => {
  it('parses https, ssh, with/without .git', () => {
    expect(parseRepoUrl('https://github.com/DuchitskyDA/ai')).toEqual({ owner: 'DuchitskyDA', name: 'ai' })
    expect(parseRepoUrl('https://github.com/DuchitskyDA/ai.git')).toEqual({ owner: 'DuchitskyDA', name: 'ai' })
    expect(parseRepoUrl('git@github.com:DuchitskyDA/ai.git')).toEqual({ owner: 'DuchitskyDA', name: 'ai' })
    expect(parseRepoUrl('totally not a url')).toBeNull()
  })
})

describe('normalizeRepoUrl', () => {
  it('makes scheme/.git/case-insensitive equal', () => {
    const a = normalizeRepoUrl('https://github.com/DuchitskyDA/ai.git')
    expect(normalizeRepoUrl('git@github.com:duchitskyda/AI')).toBe(a)
  })
})

describe('findExistingClones', () => {
  it('finds a child clone whose origin matches the url', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cs-find-'))
    const match = join(base, 'ai')
    mkdirSync(match)
    execFileSync('git', ['-C', match, 'init', '-q'])
    execFileSync('git', ['-C', match, 'remote', 'add', 'origin', 'https://github.com/DuchitskyDA/ai.git'])
    const other = join(base, 'other')
    mkdirSync(other)
    execFileSync('git', ['-C', other, 'init', '-q'])
    execFileSync('git', ['-C', other, 'remote', 'add', 'origin', 'https://github.com/x/y.git'])
    const found = await findExistingClones('git@github.com:duchitskyda/AI', [base])
    expect(found).toEqual([match])
    rmSync(base, { recursive: true, force: true })
  })
})

describe('cloneRepo', () => {
  it('clones a local source repo into target', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cs-clone-'))
    const src = join(base, 'src')
    mkdirSync(src)
    execFileSync('git', ['-C', src, 'init', '-q'])
    execFileSync('git', [
      '-C', src, '-c', 'user.email=t@t', '-c', 'user.name=t',
      'commit', '--allow-empty', '-m', 'init', '-q',
    ])
    const target = join(base, 'dst')
    const res = await cloneRepo({
      url: `file://${src.replace(/\\/g, '/')}`,
      targetPath: target,
      token: null,
      onLine: () => {},
    })
    expect(res.ok).toBe(true)
    expect(existsSync(join(target, '.git'))).toBe(true)
    rmSync(base, { recursive: true, force: true })
  })
})
