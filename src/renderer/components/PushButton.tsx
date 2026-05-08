import React from 'react'

type Props = {
  configComplete: boolean
  isRunning: boolean
  onClick: () => void
}

export function PushButton({ configComplete, isRunning, onClick }: Props) {
  const disabled = !configComplete || isRunning
  const reason = !configComplete
    ? 'Push requires Repo URL and Rules target in Settings'
    : isRunning
      ? 'Already running'
      : ''
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className="rounded-md border border-blue-600 px-5 py-2 text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-300 dark:hover:bg-blue-950 dark:disabled:border-neutral-700 dark:disabled:text-neutral-700"
    >
      {isRunning ? 'Pushing…' : 'Push Local Changes'}
    </button>
  )
}
