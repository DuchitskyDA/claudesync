import { useEffect, useReducer, useRef } from 'react'
import type {
  CursorConfig,
  GitHubAuthState,
  LocalizedMessage,
  LogLine,
  RunResult,
  StepName,
  StepStatus,
  SyncStatus,
  UpdateInfo,
  UpdateProgressEvent,
} from '@shared/api'

export type UpdaterKind = 'auto' | 'brew' | 'none' | 'unknown'
export type UpdaterFlowState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; percent: number }
  | { phase: 'ready' } // win/linux: installer downloaded, awaiting quitAndInstall
  | { phase: 'error'; message: string }

type Steps = Record<StepName, { status: StepStatus; message?: LocalizedMessage }>

const INITIAL_SYNC_STATUS: SyncStatus = {
  state: 'unknown',
  behind: 0,
  ahead: 0,
  localChanges: 0,
  fetchedAt: null,
}

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 min
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

export type AppState = {
  repoPath: string | null
  repoUrl: string | null
  rulesTarget: string | null
  cursor: CursorConfig
  platform: NodeJS.Platform | null
  arch: NodeJS.Architecture | null
  isRunning: boolean
  log: LogLine[]
  settingsOpen: boolean
  steps: Steps
  authState: GitHubAuthState | null
  conflictInProgress: boolean
  syncStatus: SyncStatus
  syncStatusChecking: boolean
  updateInfo: UpdateInfo | null
  /** Latest version the user explicitly dismissed; persisted in AppConfig. */
  lastDismissedUpdate: string | null
  updaterKind: UpdaterKind
  updaterFlow: UpdaterFlowState
  /** True when something has changed in the sync repo since the last
   *  successful Install — set after a Pull that brought commits, cleared
   *  after Install completes. */
  installPending: boolean
}

type Action =
  | { type: 'set-config'; repoPath: string | null; repoUrl: string | null; rulesTarget: string | null; cursor: CursorConfig }
  | { type: 'set-platform'; platform: NodeJS.Platform }
  | { type: 'set-arch'; arch: NodeJS.Architecture }
  | { type: 'run-start' }
  | { type: 'run-end' }
  | { type: 'append-log'; line: LogLine }
  | { type: 'clear-log' }
  | { type: 'open-settings' }
  | { type: 'close-settings' }
  | { type: 'set-step'; step: StepName; status: StepStatus; message?: LocalizedMessage }
  | { type: 'set-auth'; auth: GitHubAuthState }
  | { type: 'set-conflict'; inProgress: boolean }
  | { type: 'set-sync-status'; status: SyncStatus }
  | { type: 'set-sync-checking'; checking: boolean }
  | { type: 'set-update-info'; info: UpdateInfo }
  | { type: 'set-dismissed-update'; version: string | null }
  | { type: 'set-updater-kind'; kind: UpdaterKind }
  | { type: 'set-updater-flow'; flow: UpdaterFlowState }
  | { type: 'set-install-pending'; pending: boolean }

const initialSteps: Steps = {
  fetch: { status: 'idle' },
  install: { status: 'idle' },
  export: { status: 'idle' },
  pull: { status: 'idle' },
  commit: { status: 'idle' },
  push: { status: 'idle' },
}

const initial: AppState = {
  repoPath: null,
  repoUrl: null,
  rulesTarget: null,
  cursor: { enabled: false, projects: [] },
  platform: null,
  arch: null,
  isRunning: false,
  log: [],
  settingsOpen: false,
  steps: initialSteps,
  authState: null,
  conflictInProgress: false,
  syncStatus: INITIAL_SYNC_STATUS,
  syncStatusChecking: false,
  updateInfo: null,
  lastDismissedUpdate: null,
  updaterKind: 'unknown',
  updaterFlow: { phase: 'idle' },
  installPending: false,
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'set-config':
      return { ...s, repoPath: a.repoPath, repoUrl: a.repoUrl, rulesTarget: a.rulesTarget, cursor: a.cursor }
    case 'set-platform':
      return { ...s, platform: a.platform }
    case 'set-arch':
      return { ...s, arch: a.arch }
    case 'run-start':
      return { ...s, isRunning: true, log: [], steps: initialSteps }
    case 'run-end':
      return { ...s, isRunning: false }
    case 'append-log':
      return { ...s, log: [...s.log, a.line] }
    case 'clear-log':
      return { ...s, log: [] }
    case 'open-settings':
      return { ...s, settingsOpen: true }
    case 'close-settings':
      return { ...s, settingsOpen: false }
    case 'set-step':
      return { ...s, steps: { ...s.steps, [a.step]: { status: a.status, message: a.message } } }
    case 'set-auth':
      return { ...s, authState: a.auth }
    case 'set-conflict':
      return { ...s, conflictInProgress: a.inProgress }
    case 'set-sync-status':
      return { ...s, syncStatus: a.status }
    case 'set-sync-checking':
      return { ...s, syncStatusChecking: a.checking }
    case 'set-update-info':
      return { ...s, updateInfo: a.info }
    case 'set-dismissed-update':
      return { ...s, lastDismissedUpdate: a.version }
    case 'set-updater-kind':
      return { ...s, updaterKind: a.kind }
    case 'set-updater-flow':
      return { ...s, updaterFlow: a.flow }
    case 'set-install-pending':
      return { ...s, installPending: a.pending }
  }
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function useAppState() {
  const [state, dispatch] = useReducer(reducer, initial)
  const refreshingRef = useRef(false)

  const refreshSyncStatus = async (force = false): Promise<void> => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    dispatch({ type: 'set-sync-checking', checking: true })
    try {
      const status = force
        ? await window.api.refreshSyncStatus()
        : await window.api.getSyncStatus()
      dispatch({ type: 'set-sync-status', status })
    } finally {
      refreshingRef.current = false
      dispatch({ type: 'set-sync-checking', checking: false })
    }
  }

  const checkForUpdates = async (force = false): Promise<void> => {
    const info = force
      ? await window.api.checkForUpdates()
      : await window.api.getUpdateInfo()
    dispatch({ type: 'set-update-info', info })
  }

  const dismissUpdate = async (version: string): Promise<void> => {
    await window.api.dismissUpdate(version)
    dispatch({ type: 'set-dismissed-update', version })
  }

  const startUpdater = async (): Promise<void> => {
    dispatch({ type: 'set-updater-flow', flow: { phase: 'checking' } })
    await window.api.updaterStart()
  }

  const quitAndInstallUpdate = async (): Promise<void> => {
    await window.api.updaterQuitAndInstall()
  }

  const closeUpdater = (): void => {
    dispatch({ type: 'set-updater-flow', flow: { phase: 'idle' } })
  }

  useEffect(() => {
    void window.api.getPlatform().then((p) => dispatch({ type: 'set-platform', platform: p }))
    void window.api.getArch().then((a) => dispatch({ type: 'set-arch', arch: a }))
    void window.api.getAuthState().then((a) => dispatch({ type: 'set-auth', auth: a }))
    void window.api.conflictGetState().then((s) => {
      dispatch({ type: 'set-conflict', inProgress: s.inProgress })
    })
    void window.api.getConfig().then((c) => {
      dispatch({
        type: 'set-config',
        repoPath: c.repoPath,
        repoUrl: c.repoUrl,
        rulesTarget: c.claude.path,
        cursor: c.cursor,
      })
      dispatch({ type: 'set-dismissed-update', version: c.lastDismissedUpdate })
      if (!c.claude.path) dispatch({ type: 'open-settings' })
      // Cold-start sync-status: cached count first, then network refresh.
      void refreshSyncStatus(false).then(() => {
        if (c.repoUrl && c.repoPath) void refreshSyncStatus(true)
      })
    })

    // Update check: cached on mount, network shortly after.
    void checkForUpdates(false).then(() => {
      void checkForUpdates(true)
    })

    // Detect available updater backend.
    void window.api.updaterSupported().then((kind) =>
      dispatch({ type: 'set-updater-kind', kind }),
    )

    const unsubUpdate = window.api.onUpdateProgress((e: UpdateProgressEvent) => {
      switch (e.phase) {
        case 'checking':
          dispatch({ type: 'set-updater-flow', flow: { phase: 'checking' } })
          return
        case 'available':
        case 'downloading':
          dispatch({
            type: 'set-updater-flow',
            flow: {
              phase: 'downloading',
              percent: e.phase === 'downloading' ? e.percent : 0,
            },
          })
          return
        case 'downloaded':
          dispatch({ type: 'set-updater-flow', flow: { phase: 'ready' } })
          return
        case 'not-available':
          dispatch({ type: 'set-updater-flow', flow: { phase: 'idle' } })
          return
        case 'error':
          dispatch({ type: 'set-updater-flow', flow: { phase: 'error', message: e.message } })
          return
      }
    })

    const unsub = window.api.onLog((line) => dispatch({ type: 'append-log', line }))
    const unsubStep = window.api.onStep((e) =>
      dispatch({ type: 'set-step', step: e.step, status: e.status, message: e.message }),
    )
    const unsubInitStep = window.api.onInitStep(() => {
      /* InitWizard owns its own ProgressStep */
    })
    const unsubPushStep = window.api.onPushStep((e) => {
      dispatch({ type: 'set-step', step: e.step as StepName, status: e.status, message: e.message })
    })

    // Auto-refresh on visibility/focus + periodic poll
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshSyncStatus(true)
      }
    }
    const onFocus = () => void refreshSyncStatus(true)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshSyncStatus(true)
      }
    }, AUTO_REFRESH_INTERVAL_MS)
    const updateInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkForUpdates(true)
      }
    }, UPDATE_CHECK_INTERVAL_MS)

    return () => {
      unsub()
      unsubStep()
      unsubInitStep()
      unsubPushStep()
      unsubUpdate()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
      window.clearInterval(updateInterval)
    }
  }, [])

  const syncNow = async (): Promise<RunResult> => {
    dispatch({ type: 'run-start' })
    try {
      const r = await window.api.runSync()
      if (!r.ok && r.error) {
        const errText = r.error.fallback ?? r.error.key
        dispatch({
          type: 'append-log',
          line: { time: now(), text: errText, level: 'error' },
        })
      }
      return r
    } finally {
      dispatch({ type: 'run-end' })
      void refreshSyncStatus(true)
    }
  }

  const runPush = async (commitMessage: string, includeSecrets: boolean) => {
    dispatch({ type: 'run-start' })
    try {
      const r = await window.api.runPush({ commitMessage, includeSecrets })
      if (r.kind === 'conflict') {
        dispatch({ type: 'set-conflict', inProgress: true })
      }
      if (!r.ok && r.error) {
        const errText = r.error.fallback ?? r.error.key
        dispatch({
          type: 'append-log',
          line: { time: now(), text: errText, level: 'error' },
        })
      }
      return r
    } finally {
      dispatch({ type: 'run-end' })
      void refreshSyncStatus(true)
    }
  }

  const refreshAuth = async () => {
    const a = await window.api.getAuthState()
    dispatch({ type: 'set-auth', auth: a })
  }

  const handleSignOut = async () => {
    await window.api.signOut()
    await refreshAuth()
  }

  const setConflictInProgress = (inProgress: boolean) =>
    dispatch({ type: 'set-conflict', inProgress })

  return {
    state,
    syncNow,
    runPush,
    clearLog: () => dispatch({ type: 'clear-log' }),
    openSettings: () => dispatch({ type: 'open-settings' }),
    closeSettings: () => dispatch({ type: 'close-settings' }),
    setConfigState: (c: { repoPath: string | null; repoUrl: string | null; rulesTarget: string | null; cursor?: CursorConfig }) => {
      dispatch({
        type: 'set-config',
        repoPath: c.repoPath,
        repoUrl: c.repoUrl,
        rulesTarget: c.rulesTarget,
        cursor: c.cursor ?? state.cursor,
      })
      void refreshSyncStatus(true)
    },
    refreshAuth,
    signOut: handleSignOut,
    setConflictInProgress,
    setInstallPending: (pending: boolean) =>
      dispatch({ type: 'set-install-pending', pending }),
    refreshSyncStatus: () => refreshSyncStatus(true),
    checkForUpdates: () => checkForUpdates(true),
    dismissUpdate,
    startUpdater,
    quitAndInstallUpdate,
    closeUpdater,
  }
}
