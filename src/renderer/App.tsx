import React, { useState } from 'react'
import { useAppState } from './hooks/useAppState'
import { SyncButton } from './components/SyncButton'
import { LogConsole } from './components/LogConsole'
import { StepList } from './components/StepList'
import { Settings } from './components/Settings'
import { Header } from './components/Header'
import { Tabs } from './components/Tabs'
import { PluginsTab } from './components/PluginsTab'

type Tab = 'sync' | 'plugins'

export function App() {
  const { state, syncNow, clearLog, openSettings, closeSettings, setConfigState } = useAppState()
  const [tab, setTab] = useState<Tab>('sync')
  const [showDetails, setShowDetails] = useState(false)
  const configComplete =
    state.repoUrl !== null && state.repoPath !== null && state.rulesTarget !== null

  return (
    <div className="flex h-screen flex-col">
      <Header repoPath={state.repoPath} onOpenSettings={openSettings} />
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'sync', label: 'Sync' },
          { id: 'plugins', label: 'Plugins' },
        ]}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {tab === 'sync' ? (
          <>
            <div className="flex items-center gap-3 px-4 py-3">
              <SyncButton
                configComplete={configComplete}
                isRunning={state.isRunning}
                onClick={() => void syncNow()}
              />
              {!configComplete && (
                <button
                  onClick={openSettings}
                  className="text-xs text-blue-500 hover:underline"
                >
                  Configure repo URL →
                </button>
              )}
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
          </>
        ) : (
          <div className="flex-1 overflow-auto">
            <PluginsTab />
          </div>
        )}
      </div>
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
