import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, LogLine, AppConfig, Platform, RunResult, SetConfigResult } from '@shared/api'

const api: AppApi = {
  runUpdate: (platform: Platform): Promise<RunResult> =>
    ipcRenderer.invoke('run-update', platform),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setConfig: (c: AppConfig): Promise<SetConfigResult> => ipcRenderer.invoke('set-config', c),
  pickRepoPath: (): Promise<string | null> => ipcRenderer.invoke('pick-repo-path'),
  onLog: (callback: (line: LogLine) => void): (() => void) => {
    const listener = (_: unknown, line: LogLine) => callback(line)
    ipcRenderer.on('log', listener)
    return () => ipcRenderer.off('log', listener)
  },
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('get-platform'),
}

contextBridge.exposeInMainWorld('api', api)
