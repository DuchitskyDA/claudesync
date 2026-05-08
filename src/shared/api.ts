export type LogLevel = 'info' | 'error' | 'success'
export type LogLine = { time: string; text: string; level: LogLevel }
export type Platform = 'macos' | 'windows'
export type RunResult = { ok: boolean; exitCode: number; error?: string }
export type AppConfig = {
  repoPath: string | null
  repoUrl: string | null
  rulesTarget: string | null
  includeSecretsInPush: boolean
}
export type SetConfigResult = { ok: boolean; error?: string }

export type StepName = 'fetch' | 'install'
export type StepStatus = 'idle' | 'running' | 'done' | 'failed'
export type StepEvent = { step: StepName; status: StepStatus; message?: string }

export interface AppApi {
  runSync(): Promise<RunResult>
  getConfig(): Promise<AppConfig>
  setConfig(c: AppConfig): Promise<SetConfigResult>
  pickRepoPath(): Promise<string | null>
  onLog(callback: (line: LogLine) => void): () => void
  getPlatform(): Promise<NodeJS.Platform>
  onStep(callback: (e: StepEvent) => void): () => void
  getPluginCatalog(force?: boolean): Promise<PluginCatalog>
  getInstalledPlugins(): Promise<InstalledPluginsState>
  applyPluginChanges(changes: ApplyPluginChanges): Promise<{ ok: boolean; error?: string }>
  validateClaudeTarget(): Promise<ClaudeTargetCheck>
  detectRulesTarget(): Promise<string | null>
  suggestRulesTarget(): Promise<string>
  suggestRepoPath(url: string): Promise<string>

  // v0.4 — Auth
  getAuthState(): Promise<GitHubAuthState>
  startDeviceFlow(): Promise<DeviceFlowChallenge>
  pollDeviceFlow(): Promise<DeviceFlowResult>
  cancelDeviceFlow(): Promise<void>
  signOut(): Promise<void>

  // v0.4 — GitHub
  listOwners(): Promise<GitHubOwner[]>

  // v0.4 — Init
  scanLocalConfig(): Promise<ScanResult>
  initRepo(opts: InitWizardOptions): Promise<RunResult>
  onInitStep(callback: (e: InitStepEvent) => void): () => void

  // v0.4 — Push
  getRepoStatus(): Promise<RepoStatus>
  runPush(opts: PushOptions): Promise<RunResult>
  onPushStep(callback: (e: PushStepEvent) => void): () => void
}

declare global {
  interface Window {
    api: AppApi
  }
}

export type PluginEnvRequirement = {
  name: string
  label: string
  instructions: string
  placeholder?: string
  docsUrl?: string
  optional?: boolean
}

export type PluginMarketplace = {
  id: string
  source: { source: 'github'; repo: string }
}

export type PluginEntry = {
  id: string
  name: string
  description: string
  author?: string
  homepage?: string
  tags?: string[]
  marketplace?: PluginMarketplace
  requiresEnv?: PluginEnvRequirement[]
  recommendedFor?: string[]
}

export type PresetEntry = {
  id: string
  name: string
  description: string
  pluginIds: string[]
  icon?: string
}

export type PluginCatalog = {
  version: 1
  plugins: PluginEntry[]
  presets: PresetEntry[]
}

export type InstalledPluginsState = {
  enabledIds: string[]
  envSet: string[]
  knownMarketplaces: string[]
  marketplaceSources: Record<string, { source: string; repo: string }>
}

export type ClaudeTargetCheck =
  | { ok: true; settingsPath: string }
  | { ok: false; reason: string }

export type ApplyPluginChanges = {
  enable: PluginEntry[]
  disable: string[]
  envValues: Record<string, string>
}

// v0.4 bidirectional sync types

export type GitHubAuthState =
  | { authenticated: false }
  | { authenticated: true; login: string }

export type DeviceFlowChallenge = {
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DeviceFlowResult =
  | { ok: true }
  | { ok: false; error: string }

export type GitHubOwner = { login: string; type: 'User' | 'Organization' }

export type CreateRepoOptions = {
  owner: string
  name: string
  isPrivate: boolean
  description?: string
}

export type InitWizardOptions = CreateRepoOptions

export type PushOptions = {
  commitMessage: string
  includeSecrets: boolean
}

export type PushStep = 'export' | 'pull' | 'commit' | 'push'
export type PushStepEvent = { step: PushStep; status: StepStatus; message?: string }

export type InitStep = 'create-repo' | 'clone' | 'generate' | 'commit' | 'push'
export type InitStepEvent = { step: InitStep; status: StepStatus; message?: string }

export type ScanResult = {
  files: string[]
  excluded: string[]
  totalSize: number
}

export type RepoStatus = {
  changedFiles: string[]
  clean: boolean
}
