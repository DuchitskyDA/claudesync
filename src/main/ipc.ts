import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import type { LogLine, RunResult, AppConfig, SetConfigResult, StepEvent, ApplyPluginChanges } from '@shared/api'
import { runCommand, withRunLock } from './runner'
import {
  readConfig,
  writeConfig,
  validateLocalRepo,
  validateRepoUrl,
  validateRulesTarget,
  expandTilde,
  detectClaudeTarget,
  suggestedClaudeTargetPath,
  defaultManagedRepoPath,
} from './config'
import { fetchCatalog } from './catalog'
import { getInstalled, applyChanges, settingsPathFor, validateClaudeTarget } from './plugins'

const LOG_LIMIT = 200

export type RunSyncDeps = {
  currentPlatform: NodeJS.Platform
  configPath: string
  emit: (line: LogLine) => void
  emitStep: (e: StepEvent) => void
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fail(error: string): RunResult {
  return { ok: false, exitCode: -1, error }
}

function failWithExit(prefix: string, exitCode: number, emit: (l: LogLine) => void): RunResult {
  emit({ time: nowHHMMSS(), text: `✗ ${prefix} (exit ${exitCode})`, level: 'error' })
  return { ok: false, exitCode }
}

export async function runSyncHandler(deps: RunSyncDeps): Promise<RunResult> {
  const cfg = readConfig(deps.configPath)
  if (!cfg.repoUrl) return fail('Repo URL not configured. Open Settings.')
  if (!cfg.repoPath) return fail('Local repo path not configured. Open Settings.')
  if (!cfg.rulesTarget) return fail('Rules target folder not configured. Open Settings.')

  const u = validateRepoUrl(cfg.repoUrl)
  if (!u.ok) return fail(u.error)
  const p = validateLocalRepo(cfg.repoPath)
  if (!p.ok) return fail(p.error)
  const t = validateRulesTarget(cfg.rulesTarget)
  if (!t.ok) return fail(t.error)

  const repoUrl = cfg.repoUrl
  const repoPath = cfg.repoPath
  const rulesTarget = cfg.rulesTarget
  const isWin = deps.currentPlatform === 'win32'

  return withRunLock(async () => {
    const isExistingRepo = existsSync(join(repoPath, '.git'))
    deps.emitStep({ step: 'fetch', status: 'running' })
    if (!isExistingRepo) {
      deps.emit({ time: nowHHMMSS(), text: `$ git clone ${repoUrl} ${repoPath}`, level: 'info' })
      mkdirSync(dirname(repoPath), { recursive: true })
      const clone = await runCommand('git', ['clone', repoUrl, repoPath], {
        cwd: dirname(repoPath),
        onLine: deps.emit,
      })
      if (clone.exitCode !== 0) {
        deps.emitStep({ step: 'fetch', status: 'failed', message: `git clone failed (exit ${clone.exitCode})` })
        return failWithExit('git clone failed', clone.exitCode, deps.emit)
      }
    } else {
      deps.emit({ time: nowHHMMSS(), text: '$ git pull', level: 'info' })
      const pull = await runCommand('git', ['pull'], { cwd: repoPath, onLine: deps.emit })
      if (pull.exitCode !== 0) {
        deps.emitStep({ step: 'fetch', status: 'failed', message: `git pull failed (exit ${pull.exitCode})` })
        return failWithExit('git pull failed', pull.exitCode, deps.emit)
      }
    }
    deps.emitStep({ step: 'fetch', status: 'done' })

    const scriptName = isWin ? 'install.ps1' : 'install.sh'
    const scriptPath = join(repoPath, scriptName)
    if (!existsSync(scriptPath)) {
      return fail(`${scriptName} not found in repo root`)
    }

    deps.emit({
      time: nowHHMMSS(),
      text: `$ ${scriptName} (RULES_TARGET=${rulesTarget})`,
      level: 'info',
    })

    deps.emitStep({ step: 'install', status: 'running' })
    const env = { RULES_TARGET: rulesTarget }
    const inst = isWin
      ? await runCommand(
          'powershell',
          ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          { cwd: repoPath, env, onLine: deps.emit },
        )
      : await runCommand('bash', [scriptPath], { cwd: repoPath, env, onLine: deps.emit })

    if (inst.exitCode !== 0) {
      deps.emitStep({ step: 'install', status: 'failed', message: `install failed (exit ${inst.exitCode})` })
      return failWithExit('install failed', inst.exitCode, deps.emit)
    }
    deps.emitStep({ step: 'install', status: 'done' })
    deps.emit({ time: nowHHMMSS(), text: '✓ DONE (exit 0)', level: 'success' })
    return { ok: true, exitCode: 0 }
  }).catch((e: Error) => ({ ok: false, exitCode: -1, error: e.message }))
}

export function registerIpc(window: BrowserWindow): void {
  const configPath = join(app.getPath('userData'), 'config.json')
  const logFile = join(app.getPath('userData'), 'last-run.log')
  const logBuffer: LogLine[] = []
  const emit = (line: LogLine) => {
    if (!window.isDestroyed()) window.webContents.send('log', line)
    logBuffer.push(line)
    if (logBuffer.length > LOG_LIMIT) logBuffer.shift()
    try {
      writeFileSync(
        logFile,
        logBuffer.map((l) => `[${l.time}] ${l.level.toUpperCase()} ${l.text}`).join('\n') + '\n',
      )
    } catch {
      // ignore disk errors
    }
  }
  const emitStep = (e: StepEvent) => {
    if (!window.isDestroyed()) window.webContents.send('step', e)
  }

  ipcMain.handle('run-sync', () =>
    runSyncHandler({ currentPlatform: process.platform, configPath, emit, emitStep }),
  )

  ipcMain.handle('get-config', (): AppConfig => readConfig(configPath))

  ipcMain.handle('set-config', (_e, cfg: AppConfig): SetConfigResult => {
    const normalized: AppConfig = {
      repoUrl: cfg.repoUrl,
      repoPath: cfg.repoPath ? expandTilde(cfg.repoPath) : null,
      rulesTarget: cfg.rulesTarget ? expandTilde(cfg.rulesTarget) : null,
      includeSecretsInPush: cfg.includeSecretsInPush ?? false,
    }
    if (normalized.repoUrl) {
      const u = validateRepoUrl(normalized.repoUrl)
      if (!u.ok) return { ok: false, error: u.error }
    }
    if (normalized.repoPath) {
      const p = validateLocalRepo(normalized.repoPath)
      if (!p.ok) return { ok: false, error: p.error }
    }
    if (normalized.rulesTarget) {
      const t = validateRulesTarget(normalized.rulesTarget)
      if (!t.ok) return { ok: false, error: t.error }
    }
    writeConfig(configPath, normalized)
    return { ok: true }
  })

  ipcMain.handle('pick-repo-path', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0] ?? null
  })

  ipcMain.handle('get-platform', (): NodeJS.Platform => process.platform)

  ipcMain.handle('get-plugin-catalog', (_e, force?: boolean) => fetchCatalog({ force }))

  ipcMain.handle('get-installed-plugins', () => {
    const cfg = readConfig(configPath)
    if (!cfg.rulesTarget) return { enabledIds: [], envSet: [], knownMarketplaces: [] }
    return getInstalled(settingsPathFor(cfg.rulesTarget))
  })

  ipcMain.handle('apply-plugin-changes', (_e, changes: ApplyPluginChanges) => {
    const cfg = readConfig(configPath)
    if (!cfg.rulesTarget) return { ok: false, error: 'Rules target not configured' }
    const settingsPath = settingsPathFor(cfg.rulesTarget)
    return applyChanges(settingsPath, changes)
  })

  ipcMain.handle('validate-claude-target', () => {
    const cfg = readConfig(configPath)
    return validateClaudeTarget(cfg.rulesTarget)
  })

  ipcMain.handle('detect-rules-target', () => detectClaudeTarget())
  ipcMain.handle('suggest-rules-target', () => suggestedClaudeTargetPath())
  ipcMain.handle('suggest-repo-path', (_e, url: string) =>
    defaultManagedRepoPath(url, app.getPath('userData')),
  )
}
