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
}

declare global {
  interface Window {
    api: AppApi
  }
}
