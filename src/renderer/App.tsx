import React from 'react'
import { useAppState } from './hooks/useAppState'
import { LogConsole } from './components/LogConsole'
import { Settings } from './components/Settings'
import { Header } from './components/Header'

export function App() {
  const { state, clearLog, openSettings, closeSettings, setRepoPath } = useAppState()
  return (
    <div className="flex h-screen flex-col">
      <Header repoPath={state.repoPath} onOpenSettings={openSettings} />
      <div className="flex items-center gap-3 px-4 py-3">
        {/* SyncButton will be added in Task 5 */}
      </div>
      <div className="flex-1 overflow-hidden border-t border-neutral-200 dark:border-neutral-700">
        <LogConsole lines={state.log} onClear={clearLog} />
      </div>
      <Settings
        open={state.settingsOpen}
        initialRepoPath={state.repoPath}
        onClose={closeSettings}
        onSaved={setRepoPath}
      />
    </div>
  )
}
