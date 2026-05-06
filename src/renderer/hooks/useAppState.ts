import { useEffect, useReducer } from 'react'
import type { LogLine } from '@shared/api'

export type AppState = {
  repoPath: string | null
  platform: NodeJS.Platform | null
  isRunning: boolean
  log: LogLine[]
  settingsOpen: boolean
}

type Action =
  | { type: 'set-config'; repoPath: string | null }
  | { type: 'set-platform'; platform: NodeJS.Platform }
  | { type: 'run-start' }
  | { type: 'run-end' }
  | { type: 'append-log'; line: LogLine }
  | { type: 'clear-log' }
  | { type: 'open-settings' }
  | { type: 'close-settings' }

const initial: AppState = {
  repoPath: null,
  platform: null,
  isRunning: false,
  log: [],
  settingsOpen: false,
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'set-config':
      return { ...s, repoPath: a.repoPath }
    case 'set-platform':
      return { ...s, platform: a.platform }
    case 'run-start':
      return { ...s, isRunning: true, log: [] }
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
  }
}

export function useAppState() {
  const [state, dispatch] = useReducer(reducer, initial)

  useEffect(() => {
    void window.api.getPlatform().then((p) => dispatch({ type: 'set-platform', platform: p }))
    void window.api.getConfig().then((c) => {
      dispatch({ type: 'set-config', repoPath: c.repoPath })
      if (!c.repoPath) dispatch({ type: 'open-settings' })
    })
    const unsub = window.api.onLog((line) => dispatch({ type: 'append-log', line }))
    return () => unsub()
  }, [])

  return {
    state,
    clearLog: () => dispatch({ type: 'clear-log' }),
    openSettings: () => dispatch({ type: 'open-settings' }),
    closeSettings: () => dispatch({ type: 'close-settings' }),
    setRepoPath: (p: string | null) => dispatch({ type: 'set-config', repoPath: p }),
  }
}
