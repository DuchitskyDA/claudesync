import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppApi,
  LogLine,
  AppConfig,
  RunResult,
  SetConfigResult,
  StepEvent,
  PluginCatalog,
  InstalledPluginsState,
  ApplyPluginChanges,
  ClaudeTargetCheck,
} from '@shared/api'

const api: AppApi = {
  runSync: (): Promise<RunResult> =>
    ipcRenderer.invoke('run-sync'),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setConfig: (c: AppConfig): Promise<SetConfigResult> => ipcRenderer.invoke('set-config', c),
  pickRepoPath: (): Promise<string | null> => ipcRenderer.invoke('pick-repo-path'),
  onLog: (callback: (line: LogLine) => void): (() => void) => {
    const listener = (_: unknown, line: LogLine) => callback(line)
    ipcRenderer.on('log', listener)
    return () => ipcRenderer.off('log', listener)
  },
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('get-platform'),
  onStep: (callback: (e: StepEvent) => void): (() => void) => {
    const listener = (_: unknown, e: StepEvent) => callback(e)
    ipcRenderer.on('step', listener)
    return () => ipcRenderer.off('step', listener)
  },
  getPluginCatalog: (force?: boolean): Promise<PluginCatalog> =>
    ipcRenderer.invoke('get-plugin-catalog', force),
  getInstalledPlugins: (): Promise<InstalledPluginsState> =>
    ipcRenderer.invoke('get-installed-plugins'),
  applyPluginChanges: (c: ApplyPluginChanges): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('apply-plugin-changes', c),
  validateClaudeTarget: (): Promise<ClaudeTargetCheck> =>
    ipcRenderer.invoke('validate-claude-target'),
}

contextBridge.exposeInMainWorld('api', api)
