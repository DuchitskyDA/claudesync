import React from 'react'
import type { Platform } from '@shared/api'

type Props = {
  platform: Platform
  currentPlatform: NodeJS.Platform | null
  isRunning: boolean
  hasRepoPath: boolean
  onClick: () => void
}

const labels: Record<Platform, string> = {
  macos: 'Обновить (macOS)',
  windows: 'Обновить (Windows)',
}

const matchOs: Record<Platform, NodeJS.Platform> = {
  macos: 'darwin',
  windows: 'win32',
}

export function UpdateButton({ platform, currentPlatform, isRunning, hasRepoPath, onClick }: Props) {
  const wrongOs = currentPlatform !== null && currentPlatform !== matchOs[platform]
  const disabled = isRunning || wrongOs || !hasRepoPath
  const reason = wrongOs
    ? `Available only on ${platform === 'macos' ? 'macOS' : 'Windows'}`
    : !hasRepoPath
      ? 'Set repo path first'
      : isRunning
        ? 'Already running'
        : ''

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className="rounded-md bg-blue-600 px-4 py-2 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 dark:disabled:bg-neutral-700"
    >
      {labels[platform]}
    </button>
  )
}
