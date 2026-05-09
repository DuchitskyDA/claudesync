import React from 'react'
import { Button } from './ui/button'
import { useT } from '../i18n'

type Props = {
  configComplete: boolean
  isRunning: boolean
  onClick: () => void
}

export function InstallButton({ configComplete, isRunning, onClick }: Props) {
  const t = useT()
  const disabled = !configComplete || isRunning
  const reason = !configComplete
    ? t('install.tooltip.notConfigured')
    : isRunning
      ? t('install.tooltip.running')
      : ''
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled} title={reason}>
      {isRunning ? t('install.button.running') : t('install.button')}
    </Button>
  )
}
