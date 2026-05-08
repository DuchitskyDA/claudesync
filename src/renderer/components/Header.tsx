import React from 'react'
import type { GitHubAuthState, SyncStatus } from '@shared/api'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from './ui/button'
import { useT } from '../i18n'
import { SyncStatusChip } from './SyncStatusChip'

type Props = {
  repoPath: string | null
  authState: GitHubAuthState | null
  syncStatus: SyncStatus
  syncStatusChecking: boolean
  onOpenSettings: () => void
  onRefreshSync: () => void
}

export function Header({
  repoPath,
  authState,
  syncStatus,
  syncStatusChecking,
  onOpenSettings,
  onRefreshSync,
}: Props) {
  const t = useT()
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-sm font-semibold tracking-tight">claudesync</h1>
        <button
          onClick={onOpenSettings}
          className="truncate rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          title={repoPath ?? t('header.repoClickHint')}
        >
          {repoPath ?? t('header.noRepo')}
        </button>
        <SyncStatusChip
          status={syncStatus}
          checking={syncStatusChecking}
          onRefresh={onRefreshSync}
        />
      </div>
      <div className="flex items-center gap-2">
        {authState?.authenticated ? (
          <span className="text-xs text-muted-foreground">
            {t('header.signedInAs', { login: authState.login })}
          </span>
        ) : (
          <Button variant="link" size="sm" onClick={onOpenSettings} className="h-auto p-0 text-xs">
            {t('header.signIn')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label={t('header.openSettings')}
          className="h-7 w-7"
        >
          <SettingsIcon className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
