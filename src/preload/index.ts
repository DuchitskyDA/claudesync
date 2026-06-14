import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppApi,
  LogLine,
  AppConfig,
  RunResult,
  SetConfigResult,
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
  SyncStatus,
  UpdateInfo,
  UpdateProgressEvent,
  PullPreviewResult,
} from '@shared/api'
import type { ResolverState } from '@shared/sync-types'

const api: AppApi = {
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
  runRepoGitDiag: (cmd): Promise<void> => ipcRenderer.invoke('run-repo-git-diag', cmd),
  openRepoFolder: (): Promise<void> => ipcRenderer.invoke('open-repo-folder'),
  cloneRepo: (url, targetPath): Promise<import('@shared/api').CloneResult> =>
    ipcRenderer.invoke('clone-repo', url, targetPath),
  findExistingClones: (url): Promise<string[]> =>
    ipcRenderer.invoke('find-existing-clones', url),
  adoptRepoPath: (path): Promise<{ ok: boolean; error?: import('@shared/api').LocalizedMessage }> =>
    ipcRenderer.invoke('adopt-repo-path', path),
  getPluginCatalog: (force?: boolean): Promise<PluginCatalog> =>
    ipcRenderer.invoke('get-plugin-catalog', force),
  getInstalledPlugins: (): Promise<InstalledPluginsState> =>
    ipcRenderer.invoke('get-installed-plugins'),
  applyPluginChanges: (c: ApplyPluginChanges): Promise<{ ok: boolean; error?: LocalizedMessage }> =>
    ipcRenderer.invoke('apply-plugin-changes', c),
  validateClaudeTarget: (): Promise<ClaudeTargetCheck> =>
    ipcRenderer.invoke('validate-claude-target'),
  detectClaudePath: (): Promise<string | null> =>
    ipcRenderer.invoke('detect-claude-path'),
  suggestClaudePath: (): Promise<string> =>
    ipcRenderer.invoke('suggest-claude-path'),
  pickCursorProjectPath: (): Promise<string | null> =>
    ipcRenderer.invoke('pick-cursor-project-path'),
  validateCursorProject: (p: { name: string; path: string }) =>
    ipcRenderer.invoke('validate-cursor-project', p),
  bootstrapCursorProject: (path: string): Promise<{ created: string[] }> =>
    ipcRenderer.invoke('bootstrap-cursor-project', path),
  /** @deprecated use detectClaudePath */
  detectRulesTarget: (): Promise<string | null> =>
    ipcRenderer.invoke('detect-rules-target'),
  /** @deprecated use suggestClaudePath */
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
  checkRepoExists: (owner: string, name: string): Promise<boolean> =>
    ipcRenderer.invoke('check-repo-exists', owner, name),

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
  previewPushStatus: (): Promise<RepoStatus> =>
    ipcRenderer.invoke('preview-push-status'),
  runInstall: (opts: import('@shared/api').InstallOptions): Promise<RunResult> =>
    ipcRenderer.invoke('run-install', opts),
  computePullPreview: (): Promise<PullPreviewResult> =>
    ipcRenderer.invoke('compute-pull-preview'),
  executePullApply: (deletionsToApply: string[]): Promise<RunResult> =>
    ipcRenderer.invoke('execute-pull-apply', deletionsToApply),
  checkInstallNeeded: (): Promise<boolean> =>
    ipcRenderer.invoke('check-install-needed'),
  listRepoCursorSubdirs: (): Promise<string[]> =>
    ipcRenderer.invoke('list-repo-cursor-subdirs'),
  discardLocalChanges: (deleteAdded?: boolean): Promise<RunResult> =>
    ipcRenderer.invoke('discard-local-changes', deleteAdded),
  openRepoFile: (relPath: string): Promise<void> =>
    ipcRenderer.invoke('open-repo-file', relPath),
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

  // v1.0 — Engine Resolver
  resolverGetState: (): Promise<ResolverState | null> =>
    ipcRenderer.invoke('resolver-get-state'),
  resolverExecute: (
    commitMessage: string,
    resolutions: ResolverState,
  ): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> =>
    ipcRenderer.invoke('resolver-execute', commitMessage, resolutions),
  resolverDiscard: (): Promise<void> =>
    ipcRenderer.invoke('resolver-discard'),

  rescanClaudeProjects: (): Promise<import('@shared/api').ClaudeProject[]> =>
    ipcRenderer.invoke('rescan-claude-projects'),
}

contextBridge.exposeInMainWorld('api', api)
