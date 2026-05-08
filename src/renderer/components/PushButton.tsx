import React from 'react'
import { useT } from '../i18n'

type Props = {
  configComplete: boolean
  isRunning: boolean
  onClick: () => void
}

export function PushButton({ configComplete, isRunning, onClick }: Props) {
  const t = useT()
  const disabled = !configComplete || isRunning
  const reason = !configComplete
    ? t('push.tooltip.notConfigured')
    : isRunning
      ? t('push.tooltip.running')
      : ''
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className="rounded-md border border-blue-600 bg-transparent px-4 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400 dark:hover:bg-blue-950 dark:disabled:border-neutral-700 dark:disabled:text-neutral-600"
    >
      {isRunning ? t('push.button.running') : t('push.button')}
    </button>
  )
}
