import React, { useState } from 'react'
import type { GitHubAuthState, GitDiagCmd, SyncStatus } from '@shared/api'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useT } from '../i18n'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { RepoPathPopover } from './RepoPathPopover'

type Props = {
  repoPath: string | null
  authState: GitHubAuthState | null
  syncStatus: SyncStatus
  syncStatusChecking: boolean
  logOpen: boolean
  onToggleLog: () => void
  onRefreshSync: () => void
  onOpenSettings: () => void
  onPush: () => void
  onPull: () => void
  onResolve: () => void
  onDiscard: () => Promise<void> | void
  onRunRepoDiag: (cmd: GitDiagCmd) => void
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return p
  return `…/${parts.slice(-2).join('/')}`
}

export function StatusBar({
  repoPath,
  authState,
  syncStatus,
  syncStatusChecking,
  logOpen,
  onToggleLog,
  onRefreshSync,
  onOpenSettings,
  onPush,
  onPull,
  onResolve,
  onDiscard,
  onRunRepoDiag,
}: Props) {
  const t = useT()
  const [popoverOpen, setPopoverOpen] = useState(false)

  const onRepoClick = () => {
    if (!repoPath) {
      onOpenSettings()
      return
    }
    setPopoverOpen((v) => !v)
  }

  return (
    <footer className="flex h-7 items-center justify-between border-t bg-background px-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative">
          <button
            onClick={onRepoClick}
            title={repoPath ? t('statusBar.repo.tooltip') : t('header.repoClickHint')}
            className="truncate font-mono transition hover:text-foreground"
          >
            {repoPath ? shortPath(repoPath) : t('header.noRepo')}
          </button>
          {popoverOpen && repoPath && (
            <RepoPathPopover
              repoPath={repoPath}
              onRunDiag={onRunRepoDiag}
              onClose={() => setPopoverOpen(false)}
            />
          )}
        </div>

        <SyncStatusIndicator
          status={syncStatus}
          checking={syncStatusChecking}
          onRefresh={onRefreshSync}
          onPush={onPush}
          onPull={onPull}
          onResolve={onResolve}
          onDiscard={onDiscard}
        />
      </div>

      <div className="flex items-center gap-3">
        {authState?.authenticated ? (
          <span className="text-xs">@{authState.login}</span>
        ) : (
          <button
            onClick={onOpenSettings}
            className="text-xs transition hover:text-foreground"
          >
            {t('header.signIn')}
          </button>
        )}

        <button
          onClick={onToggleLog}
          className="flex items-center gap-1 transition hover:text-foreground"
          title={logOpen ? t('sync.log.hide') : t('sync.log.show')}
        >
          {logOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{t('statusBar.log')}</span>
        </button>
      </div>
    </footer>
  )
}
