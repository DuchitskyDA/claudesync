import { useEffect, useReducer } from 'react'
import type { LogLine, RunResult, StepName, StepStatus } from '@shared/api'

type Steps = Record<StepName, { status: StepStatus; message?: string }>

export type AppState = {
  repoPath: string | null
  repoUrl: string | null
  rulesTarget: string | null
  platform: NodeJS.Platform | null
  isRunning: boolean
  log: LogLine[]
  settingsOpen: boolean
  steps: Steps
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
  | { type: 'set-step'; step: StepName; status: StepStatus; message?: string }

const initialSteps: Steps = { fetch: { status: 'idle' }, install: { status: 'idle' } }

const initial: AppState = {
  repoPath: null,
  repoUrl: null,
  rulesTarget: null,
  platform: null,
  isRunning: false,
  log: [],
  settingsOpen: false,
  steps: initialSteps,
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
  }
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function useAppState() {
  const [state, dispatch] = useReducer(reducer, initial)

  useEffect(() => {
    void window.api.getPlatform().then((p) => dispatch({ type: 'set-platform', platform: p }))
    void window.api.getConfig().then((c) => {
      dispatch({
        type: 'set-config',
        repoPath: c.repoPath,
        repoUrl: c.repoUrl,
        rulesTarget: c.rulesTarget,
      })
      const incomplete = !c.repoUrl || !c.repoPath || !c.rulesTarget
      if (incomplete) dispatch({ type: 'open-settings' })
    })
    const unsub = window.api.onLog((line) => dispatch({ type: 'append-log', line }))
    const unsubStep = window.api.onStep((e) =>
      dispatch({ type: 'set-step', step: e.step, status: e.status, message: e.message }),
    )
    return () => {
      unsub()
      unsubStep()
    }
  }, [])

  const syncNow = async (): Promise<RunResult> => {
    dispatch({ type: 'run-start' })
    try {
      const r = await window.api.runSync()
      if (!r.ok && r.error) {
        dispatch({
          type: 'append-log',
          line: { time: now(), text: r.error, level: 'error' },
        })
      }
      return r
    } finally {
      dispatch({ type: 'run-end' })
    }
  }

  return {
    state,
    syncNow,
    clearLog: () => dispatch({ type: 'clear-log' }),
    openSettings: () => dispatch({ type: 'open-settings' }),
    closeSettings: () => dispatch({ type: 'close-settings' }),
    setConfigState: (c: { repoPath: string | null; repoUrl: string | null; rulesTarget: string | null }) =>
      dispatch({ type: 'set-config', ...c }),
  }
}
