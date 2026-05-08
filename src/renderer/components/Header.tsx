import React from 'react'
import type { GitHubAuthState } from '@shared/api'

type Props = {
  repoPath: string | null
  authState: GitHubAuthState | null
  onOpenSettings: () => void
}

export function Header({ repoPath, authState, onOpenSettings }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold">claudesync</h1>
        <button
          onClick={onOpenSettings}
          className="truncate rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          title={repoPath ?? 'Click to set'}
        >
          {repoPath ?? 'no repo configured'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {authState?.authenticated ? (
          <span className="text-xs text-neutral-500">@{authState.login}</span>
        ) : (
          <button onClick={onOpenSettings} className="text-xs text-blue-500 hover:underline">
            Sign in
          </button>
        )}
        <button
          onClick={onOpenSettings}
          aria-label="Settings"
          className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
