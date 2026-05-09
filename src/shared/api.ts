export type LogLevel = 'info' | 'error' | 'success'
export type LogLine = { time: string; text: string; level: LogLevel }
export type Platform = 'macos' | 'windows'
export type RunResult = {
  ok: boolean
  exitCode: number
  error?: LocalizedMessage
  kind?: 'conflict'
}

export type LocalizedMessage = {
  key: string
  params?: Record<string, string | number>
  /** Optional english fallback used when key missing OR for raw external text (git stderr tail) */
  fallback?: string
}
export type CursorProject = {
  /** User-visible label, used as repo subfolder under <repo>/cursor/projects/ */
  name: string
  /** Absolute path to the Cursor project root */
  path: string
}

export type ClaudeConfig = {
  enabled: boolean
  path: string | null
}

export type CursorConfig = {
  enabled: boolean
  projects: CursorProject[]
}

export type AppConfig = {
  repoPath: string | null
  repoUrl: string | null
  includeSecretsInPush: boolean
  locale: 'en' | 'ru' | null
  /** Latest version the user has dismissed; the settings-gear update dot stays
   *  hidden until GitHub publishes a tag newer than this. */
  lastDismissedUpdate: string | null
  claude: ClaudeConfig
  cursor: CursorConfig
  /** Legacy field, migrated into `claude` on read, never written. */
  rulesTarget?: string | null
}
export type SetConfigResult = { ok: boolean; error?: LocalizedMessage }

export type StepName = 'fetch' | 'install' | 'export' | 'pull' | 'commit' | 'push'
export type StepStatus = 'idle' | 'running' | 'done' | 'failed'
export type StepEvent = { step: StepName; status: StepStatus; message?: LocalizedMessage }

export interface AppApi {
  runSync(): Promise<RunResult>
  getConfig(): Promise<AppConfig>
  setConfig(c: AppConfig): Promise<SetConfigResult>
  pickRepoPath(): Promise<string | null>
  onLog(callback: (line: LogLine) => void): () => void
  getPlatform(): Promise<NodeJS.Platform>
  getArch(): Promise<NodeJS.Architecture>
  /** Grow or shrink the OS window vertically by `delta` pixels (positive = down).
   *  Used to reveal/hide the log panel without compressing the rest of the UI.
   *  Clamped to the available work area; falls back gracefully if maximised. */
  resizeWindowBy(delta: number): Promise<void>
  getSystemLocale(): Promise<string>
  openExternal(url: string): Promise<void>
  onStep(callback: (e: StepEvent) => void): () => void
  getPluginCatalog(force?: boolean): Promise<PluginCatalog>
  getInstalledPlugins(): Promise<InstalledPluginsState>
  applyPluginChanges(changes: ApplyPluginChanges): Promise<{ ok: boolean; error?: LocalizedMessage }>
  validateClaudeTarget(): Promise<ClaudeTargetCheck>
  detectClaudePath(): Promise<string | null>
  suggestClaudePath(): Promise<string>
  pickCursorProjectPath(): Promise<string | null>
  validateCursorProject(p: { name: string; path: string }): Promise<{ ok: true } | { ok: false; error: LocalizedMessage }>
  /** Creates .cursor/rules/ and .cursor/skills/ skeletons in the project
   *  (with .gitkeep files) if they don't already exist. Lets a user register
   *  a project that doesn't yet use Cursor and start syncing from scratch. */
  bootstrapCursorProject(path: string): Promise<{ created: string[] }>
  /** @deprecated use detectClaudePath */
  detectRulesTarget(): Promise<string | null>
  /** @deprecated use suggestClaudePath */
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
  /** Pre-flight: returns true if the named repo already exists for the owner.
   *  Lets the init wizard fail fast with a clear inline error instead of
   *  letting the create call bounce a 422. */
  checkRepoExists(owner: string, name: string): Promise<boolean>

  // v0.4 — Init
  scanLocalConfig(): Promise<ScanResult>
  initRepo(opts: InitWizardOptions): Promise<RunResult>
  onInitStep(callback: (e: InitStepEvent) => void): () => void

  // v0.4 — Push
  getRepoStatus(): Promise<RepoStatus>
  /** Runs all enabled exporters into the repo, then returns git status.
   *  Used by PushModal to show what WOULD be pushed; getRepoStatus alone
   *  reports a clean repo because file changes only appear after export. */
  previewPushStatus(): Promise<RepoStatus>
  /** Reverse of push: takes content from sync-repo and writes it back to
   *  the actual targets on disk. Claude install runs install.ps1/sh to
   *  refresh symlinks. Cursor install copies <repo>/cursor/projects/<name>/
   *  back into <project.path>/.cursor/ with overwrite (no backup). */
  runInstall(opts: InstallOptions): Promise<RunResult>
  /** Pure `git pull --rebase --autostash` on the sync repo. No install
   *  scripts run — Install is a separate action. */
  runPull(): Promise<RunResult>
  /** Returns true if the sync repo has content that hasn't been deployed
   *  yet for any enabled target. Used to decide whether to show the Install
   *  button on cold start / after a config change (e.g. adding a Cursor
   *  project on a freshly-cloned machine). */
  checkInstallNeeded(): Promise<boolean>
  /** Names of subdirs under <repo>/cursor/projects/. Used by the Add Cursor
   *  Project dialog to suggest "link to existing repo folder" — a project
   *  registered on machine A can be picked up on machine B by name without
   *  having to remember it. */
  listRepoCursorSubdirs(): Promise<string[]>
  /** Discard all local changes in the sync repo (modified + untracked).
   *  Equivalent to `git checkout -- . && git clean -fd`. Destructive. */
  discardLocalChanges(): Promise<RunResult>
  /** Open a file in the user's default app, given a path relative to the
   *  sync repo root. Used to inspect a single changed file from the
   *  status popover. */
  openRepoFile(relPath: string): Promise<void>
  runPush(opts: PushOptions): Promise<RunResult>
  onPushStep(callback: (e: PushStepEvent) => void): () => void

  // v0.6 — Sync status (live behind/ahead)
  getSyncStatus(): Promise<SyncStatus>
  refreshSyncStatus(): Promise<SyncStatus>

  // v0.6 — Update checker
  getUpdateInfo(): Promise<UpdateInfo>
  checkForUpdates(): Promise<UpdateInfo>
  dismissUpdate(version: string): Promise<void>

  /** Returns the kind of in-app updater available on this platform:
   *  - 'auto' on win32/linux (electron-updater)
   *  - 'brew' on darwin if /opt/homebrew/bin/brew or /usr/local/bin/brew exists
   *  - 'none' otherwise (user falls back to manual download / Terminal-brew). */
  updaterSupported(): Promise<'auto' | 'brew' | 'none'>
  /** Trigger the 1-click update flow. On win/linux: download installer in
   *  background, then `update-progress` events stream to UI; once `phase: 'downloaded'`
   *  arrives, call `updaterQuitAndInstall()`. On darwin: spawns brew, restarts
   *  app on success. */
  updaterStart(): Promise<void>
  /** Win/Linux: quit current process, run downloaded installer, relaunch new.
   *  No-op on darwin (brew handles relaunch itself). */
  updaterQuitAndInstall(): Promise<void>
  /** Subscribe to streaming update events emitted by either updater backend. */
  onUpdateProgress(cb: (e: UpdateProgressEvent) => void): () => void

  // v0.5 — Conflict resolver
  conflictGetState(): Promise<ConflictState>
  conflictGetFile(path: string, side: ConflictSide): Promise<ConflictFileContent>
  conflictResolveFile(path: string, choice: ConflictResolveChoice): Promise<ConflictResolveResult>
  conflictOpenInEditor(path: string): Promise<void>
  conflictContinue(): Promise<RunResult>
  conflictAbort(): Promise<void>
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
  | { ok: false; error: LocalizedMessage }

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

export type InstallOptions = {
  installClaude: boolean
  /** Names of registered Cursor projects to install (must match cfg.cursor.projects[].name). */
  cursorProjectNames: string[]
}

export type PushStep = 'export' | 'pull' | 'commit' | 'push'
export type PushStepEvent = { step: PushStep; status: StepStatus; message?: LocalizedMessage }

export type InitStep = 'init-local' | 'generate' | 'commit' | 'create-remote' | 'push'
export type InitStepEvent = { step: InitStep; status: StepStatus; message?: LocalizedMessage }

export type ScanResult = {
  files: string[]
  excluded: string[]
  totalSize: number
}

export type RepoStatus = {
  changedFiles: string[]
  clean: boolean
}

export type SyncStatusState =
  | 'in-sync'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'local-changes'
  | 'offline'
  | 'no-remote'
  | 'unknown'

export type SyncStatus = {
  state: SyncStatusState
  behind: number
  ahead: number
  /** count of uncommitted/untracked files in the repo working tree */
  localChanges: number
  /** unix ms of last successful fetch; null if never */
  fetchedAt: number | null
  /** error key when state === 'offline' or fetch failed; for diagnostics only */
  errorKey?: string
}

export type UpdateProgressEvent =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'not-available'; version: string }
  | { phase: 'downloading'; percent: number; transferred: number; total: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

export type UpdateInfo = {
  /** running app version, e.g. "0.6.2" */
  current: string
  /** latest release tag without leading "v", or null if check failed */
  latest: string | null
  available: boolean
  releaseUrl: string | null
  releaseNotes: string | null
  /** unix ms of last successful check; null if never */
  checkedAt: number | null
}

export type ConflictFileStatus =
  | 'unresolved'
  | 'resolved-mine'
  | 'resolved-remote'
  | 'resolved-manual'

export type ConflictFile = {
  path: string
  status: ConflictFileStatus
  binary: boolean
}

export type ConflictState = {
  inProgress: boolean
  files: ConflictFile[]
}

export type ConflictSide = 'base' | 'remote' | 'mine'

export type ConflictResolveChoice = 'mine' | 'remote' | 'manual'

export type ConflictResolveResult = { ok: true } | { ok: false; error: LocalizedMessage }

export type ConflictFileContent = { text: string | null; binary: boolean }
