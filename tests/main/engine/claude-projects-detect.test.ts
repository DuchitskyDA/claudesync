import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeClaudeProjectSegment } from '../../../src/main/sync/engine/rules'
import {
  resolveEncodedProjectPath,
  detectClaudeProjects,
} from '../../../src/main/sync/engine/claude-projects-detect'

describe('resolveEncodedProjectPath', () => {
  it('resolves a path whose folder name contains a hyphen', () => {
    const base = mkdtempSync(join(tmpdir(), 'cs-resolve-'))
    const proj = join(base, 'work', 'ERP-Front')
    mkdirSync(proj, { recursive: true })
    const encoded = encodeClaudeProjectSegment(proj)
    expect(resolveEncodedProjectPath(encoded)).toBe(proj)
    rmSync(base, { recursive: true, force: true })
  })

  it('resolves nested hyphenated names', () => {
    const base = mkdtempSync(join(tmpdir(), 'cs-resolve-'))
    const proj = join(base, 'erp-prototype-context')
    mkdirSync(proj, { recursive: true })
    expect(resolveEncodedProjectPath(encodeClaudeProjectSegment(proj))).toBe(proj)
    rmSync(base, { recursive: true, force: true })
  })

  it('returns null for a path that does not exist on this machine', () => {
    expect(resolveEncodedProjectPath('-Users-nobody-Desktop-Work-ERP-Front')).toBeNull()
  })
})

describe('detectClaudeProjects', () => {
  it('auto-detects a hyphenated project with basename as name', () => {
    const home = mkdtempSync(join(tmpdir(), 'cs-home-'))
    const realProj = join(home, 'work', 'ERP-Front')
    mkdirSync(realProj, { recursive: true })
    const enc = encodeClaudeProjectSegment(realProj)
    const segDir = join(home, '.claude', 'projects', enc)
    mkdirSync(segDir, { recursive: true })
    writeFileSync(join(segDir, 'a.jsonl'), '{}')
    const out = detectClaudeProjects(join(home, '.claude'), [])
    expect(out.find((p) => p.path === realProj)?.name).toBe('ERP-Front')
    rmSync(home, { recursive: true, force: true })
  })

  it('does not auto-register a project whose .claude is the global dir (home)', () => {
    const home = mkdtempSync(join(tmpdir(), 'cs-home2-'))
    const claudePath = join(home, '.claude')
    // Encoded segment for the home dir itself — Claude Code run in ~.
    const enc = encodeClaudeProjectSegment(home)
    const segDir = join(claudePath, 'projects', enc)
    mkdirSync(segDir, { recursive: true })
    writeFileSync(join(segDir, 'a.jsonl'), '{}')
    // home/.claude IS claudePath, so syncing it would duplicate the global
    // config — detection must skip it.
    const out = detectClaudeProjects(claudePath, [])
    expect(out.find((p) => p.path === home)).toBeUndefined()
    rmSync(home, { recursive: true, force: true })
  })
})
