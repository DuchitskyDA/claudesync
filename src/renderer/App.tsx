import React, { useEffect, useState } from 'react'
import type { PullPreviewResult } from '@shared/api'
import { useAppState } from './hooks/useAppState'
import { PullButton } from './components/PullButton'
import { PushButton } from './components/PushButton'
import { PushModal } from './components/PushModal'
import { PullModal } from './components/PullModal'
import { InstallButton } from './components/InstallButton'
import { InstallModal } from './components/InstallModal'
import { StatusBar } from './components/StatusBar'
import { ConflictModal } from './components/ConflictModal'
import { UpdateProgressModal } from './components/UpdateProgressModal'
import { InitWizard } from './components/InitWizard'
import { LogConsole } from './components/LogConsole'
import { StepList } from './components/StepList'
import { Settings } from './components/Settings'
import { Header } from './components/Header'
import { Tabs } from './components/Tabs'
import { PluginsTab } from './components/PluginsTab'
import { Button } from './components/ui/button'
import { useT } from './i18n'

type Tab = 'sync' | 'plugins'

/** Pixels added to / removed from the OS window when the user toggles the log
 *  footer, so step list / buttons aren't compressed. Matches the visual height
 *  of the rendered LogConsole inside the panel. */
const LOG_PANEL_HEIGHT = 240

export function App() {
  const {
    state,
    runPush,
    clearLog,
    openSettings,
    closeSettings,
    setConfigState,
    refreshAuth,
    signOut,
    setConflictInProgress,
    setInstallPending,
    refreshSyncStatus,
    checkForUpdates,
    startUpdater,
    quitAndInstallUpdate,
    closeUpdater,
  } = useAppState()
  const [tab, setTab] = useState<Tab>('sync')
  const [showDetails, setShowDetails] = useState(false)
  const [initOpen, setInitOpen] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [pullPreviewOpen, setPullPreviewOpen] = useState(false)
  const [pullPreviewData, setPullPreviewData] = useState<PullPreviewResult | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
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

  const handleInstall = async (opts: { installClaude: boolean; cursorProjectNames: string[] }) => {
    setInstallOpen(false)
    const r = await window.api.runInstall(opts)
    if (r.ok) setInstallPending(false)
  }

  const handlePull = async () => {
    const preview = await window.api.computePullPreview()
    if (preview.kind === 'diverged') {
      setConflictInProgress(true)
      return
    }
    if (preview.kind === 'offline') {
      // TODO: surface offline toast/banner
      return
    }
    if (preview.kind === 'nothing-to-pull') return
    setPullPreviewData(preview)
    setPullPreviewOpen(true)
  }

  const showPushBtn = state.syncStatus.localChanges > 0 || state.syncStatus.ahead > 0
  const showPullBtn = state.syncStatus.behind > 0
  const showInstallBtn = state.installPending
  const allHidden = !showPushBtn && !showPullBtn && !showInstallBtn
  const hasAnyTarget = state.rulesTarget !== null || state.cursor.projects.length > 0

  return (
    <div className="flex h-screen flex-col">
      <Header
        hasUpdate={
          state.updateInfo?.available === true &&
          state.updateInfo.latest !== null &&
          state.updateInfo.latest !== state.lastDismissedUpdate
        }
        onOpenSettings={openSettings}
      />
      {state.conflictInProgress && !conflictOpen && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          <span>{t('conflict.recovery.banner')}</span>
          <Button
            size="sm"
            onClick={() => setConflictOpen(true)}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {t('conflict.recovery.resolve')}
          </Button>
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
                <div className="text-sm text-muted-foreground">{t('sync.noRepo.title')}</div>
                <Button size="lg" onClick={() => setInitOpen(true)}>
                  {t('sync.noRepo.initialize')}
                </Button>
                <div className="text-xs text-muted-foreground">
                  {t('sync.noRepo.orSet')}{' '}
                  <button className="text-primary hover:underline" onClick={openSettings}>
                    {t('sync.noRepo.settings')}
                  </button>{' '}
                  {t('sync.noRepo.ifHave')}
                </div>
              </div>
            ) : (
              <>
                {allHidden ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted-foreground">
                    {hasAnyTarget ? (
                      <p>{t('sync.allInSync')}</p>
                    ) : (
                      <>
                        <p>{t('sync.noTargets.text')}</p>
                        <Button variant="outline" onClick={openSettings}>
                          {t('sync.noTargets.cta')}
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 px-4 py-3">
                      {showPullBtn && (
                        <PullButton
                          configComplete={configComplete}
                          isRunning={state.isRunning}
                          onClick={() => void handlePull()}
                        />
                      )}
                      {showPushBtn && (
                        <PushButton
                          configComplete={configComplete}
                          isRunning={state.isRunning}
                          onClick={() => setPushOpen(true)}
                        />
                      )}
                      {showInstallBtn && (
                        <InstallButton
                          configComplete={configComplete}
                          isRunning={state.isRunning}
                          onClick={() => setInstallOpen(true)}
                        />
                      )}
                    </div>
                    <div className="flex-1 overflow-auto border-t">
                      <StepList steps={state.steps} />
                    </div>
                  </>
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

      {/* Log panel — toggled from StatusBar. Toggle grows the OS window
          vertically by LOG_PANEL_HEIGHT so existing content isn't squashed. */}
      {tab === 'sync' && state.repoUrl !== null && showDetails && (
        <div
          className="overflow-hidden border-t"
          style={{ height: LOG_PANEL_HEIGHT }}
        >
          <LogConsole lines={state.log} onClear={clearLog} />
        </div>
      )}

      <StatusBar
        repoPath={state.repoPath}
        authState={state.authState}
        syncStatus={state.syncStatus}
        syncStatusChecking={state.syncStatusChecking}
        logOpen={showDetails}
        onToggleLog={() => {
          const willOpen = !showDetails
          setShowDetails(willOpen)
          void window.api.resizeWindowBy(willOpen ? LOG_PANEL_HEIGHT : -LOG_PANEL_HEIGHT)
        }}
        onRefreshSync={refreshSyncStatus}
        onOpenSettings={openSettings}
        onPush={() => setPushOpen(true)}
        onPull={() => void handlePull()}
        onDiscard={async () => {
          await window.api.discardLocalChanges()
          await refreshSyncStatus()
        }}
      />

      <Settings
        open={state.settingsOpen}
        initial={{
          repoUrl: state.repoUrl,
          repoPath: state.repoPath,
          rulesTarget: state.rulesTarget,
        }}
        authState={state.authState}
        updateInfo={state.updateInfo}
        platform={state.platform}
        arch={state.arch}
        updaterKind={state.updaterKind}
        onCheckForUpdates={checkForUpdates}
        onStartUpdater={() => void startUpdater()}
        onClose={closeSettings}
        onSaved={(c) => {
          setConfigState({
            repoUrl: c.repoUrl,
            repoPath: c.repoPath,
            rulesTarget: c.rulesTarget,
          })
          // Newly registered Cursor project might already have content in
          // the repo (cross-machine case: cloned repo, then added the project
          // here) — re-check whether install is needed.
          void window.api.checkInstallNeeded().then((needed) => {
            if (needed) setInstallPending(true)
          })
        }}
        onSignOut={signOut}
        onSignedIn={() => void refreshAuth()}
      />

      <InitWizard
        open={initOpen}
        authState={state.authState}
        onClose={() => setInitOpen(false)}
        onAuthChanged={() => void refreshAuth()}
        onCompleted={() => {
          void window.api.getConfig().then((c) => {
            setConfigState({
              repoUrl: c.repoUrl,
              repoPath: c.repoPath,
              rulesTarget: c.claude.path,
              cursor: c.cursor,
            })
            // Fresh init with no targets configured yet → nudge user
            // straight into Settings so they don't land on an empty Sync tab
            // wondering what to do next.
            if (!c.claude.path && c.cursor.projects.length === 0) {
              openSettings()
            }
          })
        }}
      />

      <PushModal open={pushOpen} onClose={() => setPushOpen(false)} onConfirm={handlePush} />
      <InstallModal open={installOpen} onClose={() => setInstallOpen(false)} onConfirm={handleInstall} />
      <PullModal
        open={pullPreviewOpen}
        preview={pullPreviewData}
        onClose={() => setPullPreviewOpen(false)}
        onApply={async (dels) => {
          setPullPreviewOpen(false)
          const r = await window.api.executePullApply(dels)
          await refreshSyncStatus()
          if (r.ok) {
            // optional toast on success
          }
        }}
      />

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

      <UpdateProgressModal
        flow={state.updaterFlow}
        kind={state.updaterKind}
        onClose={closeUpdater}
        onInstallNow={() => void quitAndInstallUpdate()}
      />
    </div>
  )
}
