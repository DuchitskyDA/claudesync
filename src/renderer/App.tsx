import React from 'react'
import { useAppState } from './hooks/useAppState'
import { UpdateButton } from './components/UpdateButton'
import { LogConsole } from './components/LogConsole'
import { Settings } from './components/Settings'
import { Header } from './components/Header'

export function App() {
  const { state, runUpdate, clearLog, openSettings, closeSettings, setRepoPath } = useAppState()
  return (
    <div className="flex h-screen flex-col">
      <Header repoPath={state.repoPath} onOpenSettings={openSettings} />
      <div className="flex items-center gap-3 px-4 py-3">
        <UpdateButton
          platform="macos"
          currentPlatform={state.platform}
          isRunning={state.isRunning}
          hasRepoPath={state.repoPath !== null}
          onClick={() => runUpdate('macos')}
        />
        <UpdateButton
          platform="windows"
          currentPlatform={state.platform}
          isRunning={state.isRunning}
          hasRepoPath={state.repoPath !== null}
          onClick={() => runUpdate('windows')}
        />
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
