import React from 'react'
import type { SyncStatus } from '@shared/api'
import { useT } from '../i18n'

type Props = {
  status: SyncStatus
  checking: boolean
  onRefresh: () => void
}

function formatRelative(t: (k: string, p?: Record<string, string | number>) => string, ms: number | null): string {
  if (ms === null) return t('sync.status.never')
  const diff = Math.max(0, Date.now() - ms)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return t('sync.status.justNow')
  const min = Math.floor(sec / 60)
  if (min < 60) return t('sync.status.minutesAgo', { count: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('sync.status.hoursAgo', { count: hr })
  const day = Math.floor(hr / 24)
  return t('sync.status.daysAgo', { count: day })
}

export function SyncStatusChip({ status, checking, onRefresh }: Props) {
  const t = useT()

  // No remote configured — render nothing; the empty-state UI handles that.
  if (status.state === 'no-remote') return null

  const tooltipBase = formatRelative(t, status.fetchedAt)
  const lastChecked = t('sync.status.lastChecked', { time: tooltipBase })

  const labelFor = (): { label: React.ReactNode; tone: string; tooltip: string } => {
    if (checking) {
      return {
        label: (
          <span className="flex items-center gap-1.5 text-neutral-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-500" />
            {t('sync.status.checking')}
          </span>
        ),
        tone: 'neutral',
        tooltip: t('sync.status.checking'),
      }
    }
    if (status.state === 'offline') {
      return {
        label: (
          <span className="flex items-center gap-1 text-neutral-500">
            <span aria-hidden>⚠</span>
            <span>{t('sync.status.offline')}</span>
          </span>
        ),
        tone: 'neutral',
        tooltip: `${t('sync.status.offline')} · ${lastChecked}`,
      }
    }
    if (status.state === 'unknown') {
      return {
        label: <span className="text-neutral-400">—</span>,
        tone: 'neutral',
        tooltip: t('sync.status.unknown'),
      }
    }
    if (status.state === 'in-sync') {
      return {
        label: (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <span aria-hidden>✓</span>
            <span>{t('sync.status.inSync')}</span>
          </span>
        ),
        tone: 'success',
        tooltip: lastChecked,
      }
    }
    if (status.state === 'behind') {
      return {
        label: (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span aria-hidden>↓</span>
            <span className="tabular-nums">{status.behind}</span>
          </span>
        ),
        tone: 'warning',
        tooltip: `${t('sync.status.behind', { count: status.behind })} · ${lastChecked}`,
      }
    }
    if (status.state === 'ahead') {
      return {
        label: (
          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <span aria-hidden>↑</span>
            <span className="tabular-nums">{status.ahead}</span>
          </span>
        ),
        tone: 'info',
        tooltip: `${t('sync.status.ahead', { count: status.ahead })} · ${lastChecked}`,
      }
    }
    // diverged
    return {
      label: (
        <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
          <span aria-hidden>↓</span>
          <span className="tabular-nums">{status.behind}</span>
          <span aria-hidden className="opacity-50">·</span>
          <span aria-hidden>↑</span>
          <span className="tabular-nums">{status.ahead}</span>
        </span>
      ),
      tone: 'danger',
      tooltip: `${t('sync.status.divergedTooltip', { behind: status.behind, ahead: status.ahead })} · ${lastChecked}`,
    }
  }

  const { label, tooltip } = labelFor()

  return (
    <button
      onClick={onRefresh}
      title={`${tooltip}\n${t('sync.status.refresh')}`}
      className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
    >
      {label}
    </button>
  )
}
