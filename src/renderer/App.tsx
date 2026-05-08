import React, { useEffect, useState } from 'react'
import { useAppState } from './hooks/useAppState'
import { PullButton } from './components/PullButton'
import { PushButton } from './components/PushButton'
import { PushModal } from './components/PushModal'
import { ConflictModal } from './components/ConflictModal'
import { UpdateBanner } from './components/UpdateBanner'
import { InitWizard } from './components/InitWizard'
import { LogConsole } from './components/LogConsole'
import { StepList } from './components/StepList'
import { Settings } from './components/Settings'
import { Header } from './components/Header'
import { Tabs } from './components/Tabs'
import { PluginsTab } from './components/PluginsTab'
import { useT } from './i18n'

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
    setConflictInProgress,
    refreshSyncStatus,
    dismissUpdate,
  } = useAppState()
  const [tab, setTab] = useState<Tab>('sync')
  const [showDetails, setShowDetails] = useState(false)
  const [initOpen, setInitOpen] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const t = useT()

  useEffect(() => {
    if (state.conflictInProgress) setConflictOpen(true)
  }, [state.conflictInProgress])

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
        syncStatus={state.syncStatus}
        syncStatusChecking={state.syncStatusChecking}
        onOpenSettings={openSettings}
        onRefreshSync={refreshSyncStatus}
      />
      <UpdateBanner
        info={state.updateInfo}
        lastDismissed={state.lastDismissedUpdate}
        platform={state.platform}
        arch={state.arch}
        onDismiss={(v) => void dismissUpdate(v)}
      />
      {state.conflictInProgress && !conflictOpen && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <span>{t('conflict.recovery.banner')}</span>
          <button
            onClick={() => setConflictOpen(true)}
            className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700"
          >
            {t('conflict.recovery.resolve')}
          </button>
        </div>
      )}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'sync', label: t('tabs.sync') },
          { id: 'plugins', label: t('tabs.plugins') },
        ]}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {tab === 'sync' ? (
          <>
            {state.repoUrl === null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
                <div className="text-sm text-neutral-500">{t('sync.noRepo.title')}</div>
                <button
                  onClick={() => setInitOpen(true)}
                  className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
                >
                  {t('sync.noRepo.initialize')}
                </button>
                <div className="text-xs text-neutral-500">
                  {t('sync.noRepo.orSet')}{' '}
                  <button className="text-blue-500 hover:underline" onClick={openSettings}>
                    {t('sync.noRepo.settings')}
                  </button>{' '}
                  {t('sync.noRepo.ifHave')}
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
                    className="text-xs text-neutral-500 transition hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    {showDetails ? `▾ ${t('sync.log.hide')}` : `▸ ${t('sync.log.show')}`}
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

      <ConflictModal
        open={conflictOpen}
        onClose={() => {
          setConflictOpen(false)
          setConflictInProgress(false)
        }}
        onContinued={() => {
          setConflictOpen(false)
          setConflictInProgress(false)
        }}
      />
    </div>
  )
}
