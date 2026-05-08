import React from 'react'
import { Button } from './ui/button'
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
    <Button onClick={onClick} disabled={disabled} title={reason}>
      {isRunning ? t('pull.button.running') : t('pull.button')}
    </Button>
  )
}
