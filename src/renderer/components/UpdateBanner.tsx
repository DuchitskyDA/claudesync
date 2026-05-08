import React from 'react'
import type { UpdateInfo } from '@shared/api'
import { useT } from '../i18n'
import type { UpdaterKind } from '../hooks/useAppState'

type Props = {
  info: UpdateInfo | null
  lastDismissed: string | null
  platform: NodeJS.Platform | null
  arch: NodeJS.Architecture | null
  updaterKind: UpdaterKind
  onDismiss: (version: string) => void
  onStartUpdater: () => void
}

const RELEASE_BASE = 'https://github.com/DuchitskyDA/claudesync/releases/download'

function downloadUrlFor(
  platform: NodeJS.Platform | null,
  arch: NodeJS.Architecture | null,
  version: string,
): string | null {
  if (!platform) return null
  const base = `${RELEASE_BASE}/v${version}`
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? `${base}/claudesync-${version}-arm64.dmg`
      : `${base}/claudesync-${version}.dmg`
  }
  if (platform === 'win32') {
    return `${base}/claudesync.Setup.${version}.exe`
  }
  if (platform === 'linux') {
    return `${base}/claudesync-${version}.AppImage`
  }
  return null
}

export function UpdateBanner({
  info,
  lastDismissed,
  platform,
  arch,
  updaterKind,
  onDismiss,
  onStartUpdater,
}: Props) {
  const t = useT()

  if (!info || !info.available || !info.latest) return null
  if (info.latest === lastDismissed) return null

  const handleViewRelease = () => {
    if (info.releaseUrl) void window.api.openExternal(info.releaseUrl)
  }

  const handleDismiss = () => {
    if (info.latest) onDismiss(info.latest)
  }

  const handleDirectDownload = () => {
    const url = downloadUrlFor(platform, arch, info.latest!)
    if (url) void window.api.openExternal(url)
  }

  // 1-click flow available — render the silent in-app updater button.
  const oneClick = updaterKind === 'auto' || updaterKind === 'brew'

  let primaryLabel: string
  let primaryAction: () => void
  let primaryTooltip: string | undefined

  if (oneClick) {
    primaryLabel = t('update.banner.updateNow')
    primaryAction = onStartUpdater
    primaryTooltip = t('update.banner.updateNow.tooltip')
  } else if (platform === 'darwin') {
    // brew not detected — fall back to opening Terminal with the command
    primaryLabel = t('update.banner.brewUpgrade')
    primaryAction = () => void window.api.runBrewUpgrade()
    primaryTooltip = t('update.banner.brewUpgrade.tooltip')
  } else if (platform === 'win32') {
    primaryLabel = t('update.banner.downloadInstaller')
    primaryAction = handleDirectDownload
  } else if (platform === 'linux') {
    primaryLabel = t('update.banner.downloadAppImage')
    primaryAction = handleDirectDownload
  } else {
    primaryLabel = t('update.banner.viewRelease')
    primaryAction = handleViewRelease
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
          onClick={primaryAction}
          title={primaryTooltip}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
        >
          {primaryLabel}
        </button>
        <button
          onClick={handleViewRelease}
          className="rounded-md border border-blue-300 px-3 py-1 text-xs text-blue-700 transition hover:bg-blue-100 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900"
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
