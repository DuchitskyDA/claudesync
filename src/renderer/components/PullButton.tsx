import React from 'react'

type Props = {
  configComplete: boolean
  isRunning: boolean
  onClick: () => void
}

export function PullButton({ configComplete, isRunning, onClick }: Props) {
  const disabled = !configComplete || isRunning
  const reason = !configComplete
    ? 'Pull requires Repo URL and Rules target in Settings'
    : isRunning
      ? 'Already running'
      : ''
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className="rounded-md bg-blue-600 px-5 py-2 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 dark:disabled:bg-neutral-700"
    >
      {isRunning ? 'Pulling…' : 'Pull & Install'}
    </button>
  )
}
