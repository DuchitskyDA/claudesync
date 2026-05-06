import React, { useState } from 'react'
import { useAppState } from './hooks/useAppState'
import { SyncButton } from './components/SyncButton'
import { LogConsole } from './components/LogConsole'
import { StepList } from './components/StepList'
import { Settings } from './components/Settings'
import { Header } from './components/Header'

export function App() {
  const { state, syncNow, clearLog, openSettings, closeSettings, setConfigState } = useAppState()
  const [showDetails, setShowDetails] = useState(false)
  const configComplete =
    state.repoUrl !== null && state.repoPath !== null && state.rulesTarget !== null

  return (
    <div className="flex h-screen flex-col">
      <Header repoPath={state.repoPath} onOpenSettings={openSettings} />
      <div className="flex items-center gap-3 px-4 py-3">
        <SyncButton
          configComplete={configComplete}
          isRunning={state.isRunning}
          onClick={() => void syncNow()}
        />
      </div>
      <div className="border-t border-neutral-200 dark:border-neutral-700">
        <StepList steps={state.steps} />
      </div>
      <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-1 dark:border-neutral-700">
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          {showDetails ? '▾ Hide log' : '▸ Show log'}
        </button>
      </div>
      {showDetails && (
        <div className="flex-1 overflow-hidden border-t border-neutral-200 dark:border-neutral-700">
          <LogConsole lines={state.log} onClear={clearLog} />
        </div>
      )}
      <Settings
        open={state.settingsOpen}
        initial={{ repoUrl: state.repoUrl, repoPath: state.repoPath, rulesTarget: state.rulesTarget }}
        onClose={closeSettings}
        onSaved={(c) =>
          setConfigState({ repoUrl: c.repoUrl, repoPath: c.repoPath, rulesTarget: c.rulesTarget })
        }
      />
    </div>
  )
}
