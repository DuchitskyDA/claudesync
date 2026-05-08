import React from 'react'
import { Button } from './ui/button'
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
    <Button variant="outline" onClick={onClick} disabled={disabled} title={reason}>
      {isRunning ? t('push.button.running') : t('push.button')}
    </Button>
  )
}
