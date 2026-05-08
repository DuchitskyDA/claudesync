import React from 'react'
import type { GitHubAuthState, SyncStatus } from '@shared/api'
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
    <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-sm font-semibold tracking-tight">claudesync</h1>
        <button
          onClick={onOpenSettings}
          className="truncate rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-600 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
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
          <span className="text-xs text-neutral-500">{t('header.signedInAs', { login: authState.login })}</span>
        ) : (
          <button onClick={onOpenSettings} className="text-xs text-blue-500 hover:underline">
            {t('header.signIn')}
          </button>
        )}
        <button
          onClick={onOpenSettings}
          aria-label={t('header.openSettings')}
          className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
