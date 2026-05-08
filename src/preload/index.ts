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
  GitHubAuthState,
  DeviceFlowChallenge,
  DeviceFlowResult,
  GitHubOwner,
  InitWizardOptions,
  LocalizedMessage,
  ScanResult,
  PushOptions,
  RepoStatus,
  InitStepEvent,
  PushStepEvent,
  ConflictState,
  ConflictSide,
  ConflictFileContent,
  ConflictResolveChoice,
  ConflictResolveResult,
  SyncStatus,
  UpdateInfo,
  UpdateProgressEvent,
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
  getArch: (): Promise<NodeJS.Architecture> => ipcRenderer.invoke('get-arch'),
  resizeWindowBy: (delta: number): Promise<void> => ipcRenderer.invoke('resize-window-by', delta),
  getSystemLocale: (): Promise<string> => ipcRenderer.invoke('get-system-locale'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  onStep: (callback: (e: StepEvent) => void): (() => void) => {
    const listener = (_: unknown, e: StepEvent) => callback(e)
    ipcRenderer.on('step', listener)
    return () => ipcRenderer.off('step', listener)
  },
  getPluginCatalog: (force?: boolean): Promise<PluginCatalog> =>
    ipcRenderer.invoke('get-plugin-catalog', force),
  getInstalledPlugins: (): Promise<InstalledPluginsState> =>
    ipcRenderer.invoke('get-installed-plugins'),
  applyPluginChanges: (c: ApplyPluginChanges): Promise<{ ok: boolean; error?: LocalizedMessage }> =>
    ipcRenderer.invoke('apply-plugin-changes', c),
  validateClaudeTarget: (): Promise<ClaudeTargetCheck> =>
    ipcRenderer.invoke('validate-claude-target'),
  detectRulesTarget: (): Promise<string | null> =>
    ipcRenderer.invoke('detect-rules-target'),
  suggestRulesTarget: (): Promise<string> =>
    ipcRenderer.invoke('suggest-rules-target'),
  suggestRepoPath: (url: string): Promise<string> =>
    ipcRenderer.invoke('suggest-repo-path', url),

  // v0.4 — Auth
  getAuthState: (): Promise<GitHubAuthState> =>
    ipcRenderer.invoke('get-auth-state'),
  startDeviceFlow: (): Promise<DeviceFlowChallenge> =>
    ipcRenderer.invoke('start-device-flow'),
  pollDeviceFlow: (): Promise<DeviceFlowResult> =>
    ipcRenderer.invoke('poll-device-flow'),
  cancelDeviceFlow: (): Promise<void> =>
    ipcRenderer.invoke('cancel-device-flow'),
  signOut: (): Promise<void> =>
    ipcRenderer.invoke('sign-out'),

  // v0.4 — GitHub
  listOwners: (): Promise<GitHubOwner[]> =>
    ipcRenderer.invoke('list-owners'),

  // v0.4 — Init
  scanLocalConfig: (): Promise<ScanResult> =>
    ipcRenderer.invoke('scan-local-config'),
  initRepo: (opts: InitWizardOptions): Promise<RunResult> =>
    ipcRenderer.invoke('init-repo', opts),
  onInitStep: (callback: (e: InitStepEvent) => void): (() => void) => {
    const listener = (_: unknown, e: InitStepEvent) => callback(e)
    ipcRenderer.on('init-step', listener)
    return () => ipcRenderer.off('init-step', listener)
  },

  // v0.4 — Push
  getRepoStatus: (): Promise<RepoStatus> =>
    ipcRenderer.invoke('get-repo-status'),
  runPush: (opts: PushOptions): Promise<RunResult> =>
    ipcRenderer.invoke('run-push', opts),
  onPushStep: (callback: (e: PushStepEvent) => void): (() => void) => {
    const listener = (_: unknown, e: PushStepEvent) => callback(e)
    ipcRenderer.on('push-step', listener)
    return () => ipcRenderer.off('push-step', listener)
  },

  // v0.6 — Sync status
  getSyncStatus: (): Promise<SyncStatus> =>
    ipcRenderer.invoke('get-sync-status'),
  refreshSyncStatus: (): Promise<SyncStatus> =>
    ipcRenderer.invoke('refresh-sync-status'),

  // v0.6 — Update checker
  getUpdateInfo: (): Promise<UpdateInfo> =>
    ipcRenderer.invoke('get-update-info'),
  checkForUpdates: (): Promise<UpdateInfo> =>
    ipcRenderer.invoke('check-for-updates'),
  dismissUpdate: (version: string): Promise<void> =>
    ipcRenderer.invoke('dismiss-update', version),
  runBrewUpgrade: (): Promise<void> =>
    ipcRenderer.invoke('run-brew-upgrade'),
  updaterSupported: (): Promise<'auto' | 'brew' | 'none'> =>
    ipcRenderer.invoke('updater-supported'),
  updaterStart: (): Promise<void> =>
    ipcRenderer.invoke('updater-start'),
  updaterQuitAndInstall: (): Promise<void> =>
    ipcRenderer.invoke('updater-quit-and-install'),
  onUpdateProgress: (callback: (e: UpdateProgressEvent) => void): (() => void) => {
    const listener = (_: unknown, e: UpdateProgressEvent) => callback(e)
    ipcRenderer.on('update-progress', listener)
    return () => ipcRenderer.off('update-progress', listener)
  },

  // v0.5 — Conflict resolver
  conflictGetState: (): Promise<ConflictState> =>
    ipcRenderer.invoke('conflict-get-state'),
  conflictGetFile: (path: string, side: ConflictSide): Promise<ConflictFileContent> =>
    ipcRenderer.invoke('conflict-get-file', path, side),
  conflictResolveFile: (path: string, choice: ConflictResolveChoice): Promise<ConflictResolveResult> =>
    ipcRenderer.invoke('conflict-resolve-file', path, choice),
  conflictOpenInEditor: (path: string): Promise<void> =>
    ipcRenderer.invoke('conflict-open-in-editor', path),
  conflictContinue: (): Promise<RunResult> =>
    ipcRenderer.invoke('conflict-continue'),
  conflictAbort: (): Promise<void> =>
    ipcRenderer.invoke('conflict-abort'),
}

contextBridge.exposeInMainWorld('api', api)
