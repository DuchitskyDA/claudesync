export type LogLevel = 'info' | 'error' | 'success'
export type LogLine = { time: string; text: string; level: LogLevel }
export type Platform = 'macos' | 'windows'
export type RunResult = { ok: boolean; exitCode: number; error?: string }
export type AppConfig = {
  repoPath: string | null
  repoUrl: string | null
  rulesTarget: string | null
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
}

export type ClaudeTargetCheck =
  | { ok: true; settingsPath: string }
  | { ok: false; reason: string }

export type ApplyPluginChanges = {
  enable: PluginEntry[]
  disable: string[]
  envValues: Record<string, string>
}
