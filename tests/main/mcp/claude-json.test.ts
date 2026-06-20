import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setMcpServer,
  getMcpServer,
  removeMcpServer,
  listMcpProjects,
} from '../../../src/main/mcp/claude-json'

let dir: string
let claudeJsonPath: string
let homeDir: string

const PROJECT_PATH = 'C:/Users/TestUser/myproject'
const SERVER_ID = 'yandex-tracker'
const SERVER_CFG = {
  command: '/usr/local/bin/uvx.exe',
  args: ['yandex-tracker-mcp@latest'],
  env: { TRACKER_TOKEN: 'secret-token', TRACKER_ORG_ID: '12345' },
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-json-test-'))
  claudeJsonPath = join(dir, 'claude.json')
  homeDir = join(dir, 'home')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('listMcpProjects', () => {
  it('returns empty array when file does not exist', () => {
    expect(listMcpProjects(claudeJsonPath)).toEqual([])
  })

  it('returns array of project keys when file has projects', () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        someKey: 'value',
        projects: {
          'C:/Users/A/proj1': { mcpServers: {} },
          'C:/Users/B/proj2': { mcpServers: {} },
        },
      }),
    )
    const result = listMcpProjects(claudeJsonPath)
    expect(result).toContain('C:/Users/A/proj1')
    expect(result).toContain('C:/Users/B/proj2')
    expect(result).toHaveLength(2)
  })

  it('returns empty array when projects key is missing', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({ someKey: 'value' }))
    expect(listMcpProjects(claudeJsonPath)).toEqual([])
  })
})

describe('getMcpServer', () => {
  it('returns installed:false when file does not exist', () => {
    expect(getMcpServer(PROJECT_PATH, SERVER_ID, claudeJsonPath)).toEqual({
      installed: false,
      command: null,
      args: [],
      env: {},
    })
  })

  it('returns installed:false when project does not exist in file', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({ projects: {} }))
    expect(getMcpServer(PROJECT_PATH, SERVER_ID, claudeJsonPath)).toEqual({
      installed: false,
      command: null,
      args: [],
      env: {},
    })
  })

  it('returns installed:false when server does not exist in project', () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        projects: {
          [PROJECT_PATH]: {
            allowedTools: [],
            mcpContextUris: [],
            mcpServers: {},
            enabledMcpjsonServers: [],
          },
        },
      }),
    )
    expect(getMcpServer(PROJECT_PATH, SERVER_ID, claudeJsonPath)).toEqual({
      installed: false,
      command: null,
      args: [],
      env: {},
    })
  })

  it('returns installed:true with command/args/env when server exists', () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        projects: {
          [PROJECT_PATH]: {
            allowedTools: [],
            mcpContextUris: [],
            mcpServers: {
              [SERVER_ID]: {
                type: 'stdio',
                command: SERVER_CFG.command,
                args: SERVER_CFG.args,
                env: SERVER_CFG.env,
              },
            },
            enabledMcpjsonServers: [],
          },
        },
      }),
    )
    expect(getMcpServer(PROJECT_PATH, SERVER_ID, claudeJsonPath)).toEqual({
      installed: true,
      command: SERVER_CFG.command,
      args: SERVER_CFG.args,
      env: SERVER_CFG.env,
    })
  })
})

describe('setMcpServer', () => {
  it('creates project entry with correct defaults when project does not exist', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({}))
    setMcpServer(PROJECT_PATH, SERVER_ID, SERVER_CFG, claudeJsonPath)
    const result = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as Record<string, unknown>
    const projects = result['projects'] as Record<string, unknown>
    const project = projects[PROJECT_PATH] as Record<string, unknown>
    expect(project['allowedTools']).toEqual([])
    expect(project['mcpContextUris']).toEqual([])
    expect(project['enabledMcpjsonServers']).toEqual([])
  })

  it('creates mcpServers entry with type:stdio and correct cfg', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({}))
    setMcpServer(PROJECT_PATH, SERVER_ID, SERVER_CFG, claudeJsonPath)
    const result = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as Record<string, unknown>
    const projects = result['projects'] as Record<string, unknown>
    const project = projects[PROJECT_PATH] as Record<string, unknown>
    const servers = project['mcpServers'] as Record<string, unknown>
    expect(servers[SERVER_ID]).toEqual({
      type: 'stdio',
      command: SERVER_CFG.command,
      args: SERVER_CFG.args,
      env: SERVER_CFG.env,
    })
  })

  it('preserves existing top-level keys', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({ keep: 'me', anotherKey: 42 }))
    setMcpServer(PROJECT_PATH, SERVER_ID, SERVER_CFG, claudeJsonPath)
    const result = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as Record<string, unknown>
    expect(result['keep']).toBe('me')
    expect(result['anotherKey']).toBe(42)
  })

  it('preserves existing project keys when merging', () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        projects: {
          [PROJECT_PATH]: {
            allowedTools: ['some-tool'],
            mcpContextUris: ['uri1'],
            mcpServers: { 'other-server': { type: 'stdio', command: '/bin/other', args: [], env: {} } },
            enabledMcpjsonServers: ['abc'],
            customKey: 'stays',
          },
        },
      }),
    )
    setMcpServer(PROJECT_PATH, SERVER_ID, SERVER_CFG, claudeJsonPath)
    const result = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as Record<string, unknown>
    const project = (result['projects'] as Record<string, unknown>)[PROJECT_PATH] as Record<string, unknown>
    expect((project['allowedTools'] as string[])).toContain('some-tool')
    expect((project['mcpContextUris'] as string[])).toContain('uri1')
    expect((project['enabledMcpjsonServers'] as string[])).toContain('abc')
    expect(project['customKey']).toBe('stays')
    const servers = project['mcpServers'] as Record<string, unknown>
    expect(servers['other-server']).toBeDefined()
    expect(servers[SERVER_ID]).toBeDefined()
  })

  it('throws on broken JSON and does NOT modify file', () => {
    const brokenJson = '{ broken'
    writeFileSync(claudeJsonPath, brokenJson)
    expect(() => setMcpServer(PROJECT_PATH, SERVER_ID, SERVER_CFG, claudeJsonPath)).toThrow()
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe(brokenJson)
  })

  it('creates backup in <homeDir>/.claude/backups/ when file exists', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({ existingData: true }))
    setMcpServer(PROJECT_PATH, SERVER_ID, SERVER_CFG, claudeJsonPath, homeDir)
    const backupDir = join(homeDir, '.claude', 'backups')
    expect(existsSync(backupDir)).toBe(true)
    const files = readdirSync(backupDir)
    expect(files.length).toBe(1)
    const backupName = files[0]!
    expect(backupName).toMatch(/^claude\.json\./)
    expect(backupName).toMatch(/\.backup$/)
  })

  it('does NOT create backup when file does not exist before call', () => {
    // claudeJsonPath does not exist yet
    setMcpServer(PROJECT_PATH, SERVER_ID, SERVER_CFG, claudeJsonPath, homeDir)
    const backupDir = join(homeDir, '.claude', 'backups')
    // either the dir doesn't exist, or it's empty
    if (existsSync(backupDir)) {
      expect(readdirSync(backupDir)).toHaveLength(0)
    }
  })
})

describe('removeMcpServer', () => {
  it('removes only the specified server, preserving other servers and project keys', () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        topLevel: 'preserved',
        projects: {
          [PROJECT_PATH]: {
            allowedTools: ['tool-a'],
            mcpContextUris: [],
            mcpServers: {
              [SERVER_ID]: { type: 'stdio', command: SERVER_CFG.command, args: [], env: {} },
              'other-server': { type: 'stdio', command: '/bin/other', args: [], env: {} },
            },
            enabledMcpjsonServers: [],
          },
        },
      }),
    )
    removeMcpServer(PROJECT_PATH, SERVER_ID, claudeJsonPath)
    const result = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as Record<string, unknown>
    expect(result['topLevel']).toBe('preserved')
    const project = (result['projects'] as Record<string, unknown>)[PROJECT_PATH] as Record<string, unknown>
    const servers = project['mcpServers'] as Record<string, unknown>
    expect(servers[SERVER_ID]).toBeUndefined()
    expect(servers['other-server']).toBeDefined()
    expect((project['allowedTools'] as string[])).toContain('tool-a')
  })

  it('is a no-op when project does not exist', () => {
    const initial = JSON.stringify({ projects: {} })
    writeFileSync(claudeJsonPath, initial)
    // Should not throw
    removeMcpServer(PROJECT_PATH, SERVER_ID, claudeJsonPath)
  })

  it('is a no-op when server does not exist', () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        projects: {
          [PROJECT_PATH]: {
            allowedTools: [],
            mcpContextUris: [],
            mcpServers: {},
            enabledMcpjsonServers: [],
          },
        },
      }),
    )
    // Should not throw
    removeMcpServer(PROJECT_PATH, SERVER_ID, claudeJsonPath)
  })
})
