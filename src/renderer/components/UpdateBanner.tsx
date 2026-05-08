import React from 'react'
import type { UpdateInfo } from '@shared/api'
import { useT } from '../i18n'

type Props = {
  info: UpdateInfo | null
  lastDismissed: string | null
  onDismiss: (version: string) => void
}

export function UpdateBanner({ info, lastDismissed, onDismiss }: Props) {
  const t = useT()

  if (!info || !info.available || !info.latest) return null
  if (info.latest === lastDismissed) return null

  const handleView = () => {
    if (info.releaseUrl) void window.api.openExternal(info.releaseUrl)
  }

  const handleDismiss = () => {
    if (info.latest) onDismiss(info.latest)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden>↑</span>
        <span className="truncate">
          {t('update.banner.available', {
            current: info.current,
            latest: info.latest,
          })}
        </span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          onClick={handleView}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
        >
          {t('update.banner.viewRelease')}
        </button>
        <button
          onClick={handleDismiss}
          className="rounded-md px-2 py-1 text-xs text-blue-700 transition hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-900"
        >
          {t('update.banner.dismiss')}
        </button>
      </div>
    </div>
  )
}
