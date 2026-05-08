import React from 'react'
import { useT } from '../i18n'

type Props = {
  configComplete: boolean
  isRunning: boolean
  onClick: () => void
}

export function PullButton({ configComplete, isRunning, onClick }: Props) {
  const t = useT()
  const disabled = !configComplete || isRunning
  const reason = !configComplete
    ? t('pull.tooltip.notConfigured')
    : isRunning
      ? t('pull.tooltip.running')
      : ''
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none dark:disabled:bg-neutral-700"
    >
      {isRunning ? t('pull.button.running') : t('pull.button')}
    </button>
  )
}
