import React from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from './ui/button'
import { useT } from '../i18n'

type Props = {
  /** Show a small dot on the settings gear icon when an update is available. */
  hasUpdate: boolean
  onOpenSettings: () => void
}

export function Header({ hasUpdate, onOpenSettings }: Props) {
  const t = useT()
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <h1 className="font-display text-sm font-semibold tracking-tight">claudesync</h1>
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenSettings}
        aria-label={t('header.openSettings')}
        className="relative h-7 w-7"
      >
        <SettingsIcon className="h-4 w-4" />
        {hasUpdate && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary"
          />
        )}
      </Button>
    </header>
  )
}
