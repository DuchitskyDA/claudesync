import React, { useState } from 'react'
import { useAppState } from './hooks/useAppState'
import { PullButton } from './components/PullButton'
import { PushButton } from './components/PushButton'
import { PushModal } from './components/PushModal'
import { InitWizard } from './components/InitWizard'
import { LogConsole } from './components/LogConsole'
import { StepList } from './components/StepList'
import { Settings } from './components/Settings'
import { Header } from './components/Header'
import { Tabs } from './components/Tabs'
import { PluginsTab } from './components/PluginsTab'

type Tab = 'sync' | 'plugins'

export function App() {
  const {
    state,
    syncNow,
    runPush,
    clearLog,
    openSettings,
    closeSettings,
    setConfigState,
    refreshAuth,
    signOut,
  } = useAppState()
  const [tab, setTab] = useState<Tab>('sync')
  const [showDetails, setShowDetails] = useState(false)
  const [initOpen, setInitOpen] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)

  const configComplete =
    state.repoUrl !== null && state.repoPath !== null && state.rulesTarget !== null

  const handlePush = async (msg: string, includeSecrets: boolean) => {
    setPushOpen(false)
    await runPush(msg, includeSecrets)
  }

  return (
    <div className="flex h-screen flex-col">
      <Header
        repoPath={state.repoPath}
        authState={state.authState}
        onOpenSettings={openSettings}
      />
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
            {state.repoUrl === null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
                <div className="text-sm text-neutral-500">No repo configured.</div>
                <button
                  onClick={() => setInitOpen(true)}
                  className="rounded-md bg-blue-600 px-5 py-3 text-white hover:bg-blue-700"
                >
                  Initialize new repo from current config
                </button>
                <div className="text-xs text-neutral-500">
                  Or set Repo URL in{' '}
                  <button className="text-blue-500" onClick={openSettings}>
                    ⚙ Settings
                  </button>{' '}
                  if you already have one.
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-3">
                  <PullButton
                    configComplete={configComplete}
                    isRunning={state.isRunning}
                    onClick={() => void syncNow()}
                  />
                  <PushButton
                    configComplete={configComplete}
                    isRunning={state.isRunning}
                    onClick={() => setPushOpen(true)}
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
              </>
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
        initial={{
          repoUrl: state.repoUrl,
          repoPath: state.repoPath,
          rulesTarget: state.rulesTarget,
        }}
        authState={state.authState}
        onClose={closeSettings}
        onSaved={(c) =>
          setConfigState({
            repoUrl: c.repoUrl,
            repoPath: c.repoPath,
            rulesTarget: c.rulesTarget,
          })
        }
        onSignOut={signOut}
        onSignedIn={() => void refreshAuth()}
      />

      <InitWizard
        open={initOpen}
        authState={state.authState}
        onClose={() => setInitOpen(false)}
        onAuthChanged={() => void refreshAuth()}
        onCompleted={() => {
          void window.api.getConfig().then((c) =>
            setConfigState({
              repoUrl: c.repoUrl,
              repoPath: c.repoPath,
              rulesTarget: c.rulesTarget,
            }),
          )
        }}
      />

      <PushModal open={pushOpen} onClose={() => setPushOpen(false)} onConfirm={handlePush} />
    </div>
  )
}
