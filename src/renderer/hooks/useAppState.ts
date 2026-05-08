import { useEffect, useReducer, useRef } from 'react'
import type {
  GitHubAuthState,
  LocalizedMessage,
  LogLine,
  RunResult,
  StepName,
  StepStatus,
  SyncStatus,
} from '@shared/api'

type Steps = Record<StepName, { status: StepStatus; message?: LocalizedMessage }>

const INITIAL_SYNC_STATUS: SyncStatus = {
  state: 'unknown',
  behind: 0,
  ahead: 0,
  fetchedAt: null,
}

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 min

export type AppState = {
  repoPath: string | null
  repoUrl: string | null
  rulesTarget: string | null
  platform: NodeJS.Platform | null
  isRunning: boolean
  log: LogLine[]
  settingsOpen: boolean
  steps: Steps
  authState: GitHubAuthState | null
  conflictInProgress: boolean
  syncStatus: SyncStatus
  syncStatusChecking: boolean
}

type Action =
  | { type: 'set-config'; repoPath: string | null; repoUrl: string | null; rulesTarget: string | null }
  | { type: 'set-platform'; platform: NodeJS.Platform }
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
  platform: null,
  isRunning: false,
  log: [],
  settingsOpen: false,
  steps: initialSteps,
  authState: null,
  conflictInProgress: false,
  syncStatus: INITIAL_SYNC_STATUS,
  syncStatusChecking: false,
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'set-config':
      return { ...s, repoPath: a.repoPath, repoUrl: a.repoUrl, rulesTarget: a.rulesTarget }
    case 'set-platform':
      return { ...s, platform: a.platform }
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

  useEffect(() => {
    void window.api.getPlatform().then((p) => dispatch({ type: 'set-platform', platform: p }))
    void window.api.getAuthState().then((a) => dispatch({ type: 'set-auth', auth: a }))
    void window.api.conflictGetState().then((s) => {
      dispatch({ type: 'set-conflict', inProgress: s.inProgress })
    })
    void window.api.getConfig().then((c) => {
      dispatch({
        type: 'set-config',
        repoPath: c.repoPath,
        repoUrl: c.repoUrl,
        rulesTarget: c.rulesTarget,
      })
      if (!c.rulesTarget) dispatch({ type: 'open-settings' })
      // Cold-start sync-status: cached count first, then network refresh.
      void refreshSyncStatus(false).then(() => {
        if (c.repoUrl && c.repoPath) void refreshSyncStatus(true)
      })
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

    return () => {
      unsub()
      unsubStep()
      unsubInitStep()
      unsubPushStep()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
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
    setConfigState: (c: { repoPath: string | null; repoUrl: string | null; rulesTarget: string | null }) => {
      dispatch({ type: 'set-config', ...c })
      void refreshSyncStatus(true)
    },
    refreshAuth,
    signOut: handleSignOut,
    setConflictInProgress,
    refreshSyncStatus: () => refreshSyncStatus(true),
  }
}
