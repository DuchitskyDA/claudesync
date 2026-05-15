import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateClaudeStructure,
  detectClaudeInstallMode,
} from '../../src/main/sync/claude'

let dir: string
let claudePath: string
let repoPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-cl-'))
  claudePath = join(dir, 'claude')
  repoPath = join(dir, 'repo')
  mkdirSync(claudePath, { recursive: true })
  mkdirSync(repoPath, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('generateClaudeStructure', () => {
  it('canonicalizes settings.json with only allow-list keys', async () => {
    writeFileSync(
      join(claudePath, 'settings.json'),
      '{"permissions":{"allow":["x"]},"env":{"K":"v"},"numStartups":42}',
    )
    await generateClaudeStructure(claudePath, repoPath)
    const out = readFileSync(join(repoPath, 'claude', 'settings.json'), 'utf8')
    expect(out).toBe('{\n  "permissions": {\n    "allow": [\n      "x"\n    ]\n  }\n}')
  })

  it('places registered projects/<encoded>/memory under <repo>/claude/projects/<name>/memory', async () => {
    mkdirSync(join(claudePath, 'projects', 'enc', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'enc', 'memory', 'a.md'), 'A')
    await generateClaudeStructure(claudePath, repoPath, [{ name: 'myproj', path: 'enc' }])
    expect(
      existsSync(join(repoPath, 'claude', 'projects', 'myproj', 'memory', 'a.md')),
    ).toBe(true)
  })

  it('skips unregistered projects/<encoded>/memory entries', async () => {
    mkdirSync(join(claudePath, 'projects', 'enc', 'memory'), { recursive: true })
    writeFileSync(join(claudePath, 'projects', 'enc', 'memory', 'a.md'), 'A')
    await generateClaudeStructure(claudePath, repoPath /* no projects */)
    expect(existsSync(join(repoPath, 'claude', 'projects'))).toBe(false)
  })

  it('writes CLAUDE.md and commands when present', async () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'rules\n')
    mkdirSync(join(claudePath, 'commands'), { recursive: true })
    writeFileSync(join(claudePath, 'commands', 'a.md'), 'A\n')
    await generateClaudeStructure(claudePath, repoPath)
    expect(readFileSync(join(repoPath, 'claude', 'CLAUDE.md'), 'utf8')).toBe('rules\n')
    expect(readFileSync(join(repoPath, 'claude', 'commands', 'a.md'), 'utf8')).toBe('A\n')
  })

  it('skips entries outside the sync-rules surface', async () => {
    // plugins/, history.jsonl, .credentials.json, sessions/ never enter the repo
    mkdirSync(join(claudePath, 'plugins'), { recursive: true })
    writeFileSync(join(claudePath, 'plugins', 'x'), 'X')
    writeFileSync(join(claudePath, 'history.jsonl'), 'H')
    writeFileSync(join(claudePath, '.credentials.json'), 'C')
    await generateClaudeStructure(claudePath, repoPath)
    expect(existsSync(join(repoPath, 'claude', 'plugins'))).toBe(false)
    expect(existsSync(join(repoPath, 'claude', 'history.jsonl'))).toBe(false)
    expect(existsSync(join(repoPath, 'claude', '.credentials.json'))).toBe(false)
  })
})

describe('detectClaudeInstallMode', () => {
  it('returns "copy" when CLAUDE.md does not exist', () => {
    expect(detectClaudeInstallMode(claudePath)).toBe('copy')
  })

  it('returns "copy" when CLAUDE.md is a regular file', () => {
    writeFileSync(join(claudePath, 'CLAUDE.md'), 'hi')
    expect(detectClaudeInstallMode(claudePath)).toBe('copy')
  })

  it('returns "symlink" when CLAUDE.md is a symbolic link', () => {
    // Create a target file then symlink to it. On Windows this requires Developer
    // Mode or admin rights; skip the assertion gracefully if symlink creation fails.
    const target = join(dir, 'target.md')
    writeFileSync(target, 'rules\n')
    const link = join(claudePath, 'CLAUDE.md')
    try {
      symlinkSync(target, link, 'file')
    } catch {
      // Insufficient privileges — skip rather than fail.
      return
    }
    expect(detectClaudeInstallMode(claudePath)).toBe('symlink')
  })
})
