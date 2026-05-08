import React from 'react'
import type { SyncStatus } from '@shared/api'
import { Loader2, AlertTriangle, ArrowDown, ArrowUp, Check, Circle } from 'lucide-react'
import { Badge } from './ui/badge'
import { useT } from '../i18n'
import { cn } from '@/lib/utils'

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

  if (status.state === 'no-remote') return null

  const tooltipBase = formatRelative(t, status.fetchedAt)
  const lastChecked = t('sync.status.lastChecked', { time: tooltipBase })

  type ChipInfo = {
    label: React.ReactNode
    variant: 'secondary' | 'success' | 'warning' | 'info' | 'destructive' | 'outline'
    tooltip: string
  }

  const info: ChipInfo = (() => {
    if (checking) {
      return {
        label: (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('sync.status.checking')}
          </span>
        ),
        variant: 'secondary',
        tooltip: t('sync.status.checking'),
      }
    }
    if (status.state === 'offline') {
      return {
        label: (
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            <span>{t('sync.status.offline')}</span>
          </span>
        ),
        variant: 'secondary',
        tooltip: `${t('sync.status.offline')} · ${lastChecked}`,
      }
    }
    if (status.state === 'unknown') {
      return {
        label: <span className="text-muted-foreground">—</span>,
        variant: 'outline',
        tooltip: t('sync.status.unknown'),
      }
    }
    if (status.state === 'in-sync') {
      return {
        label: (
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3" />
            <span>{t('sync.status.inSync')}</span>
          </span>
        ),
        variant: 'success',
        tooltip: lastChecked,
      }
    }
    if (status.state === 'local-changes') {
      return {
        label: (
          <span className="flex items-center gap-1">
            <Circle className="h-2.5 w-2.5 fill-current" />
            <span className="tabular-nums">{status.localChanges}</span>
          </span>
        ),
        variant: 'info',
        tooltip: `${t('sync.status.localChanges', { count: status.localChanges })} · ${lastChecked}`,
      }
    }
    if (status.state === 'behind') {
      return {
        label: (
          <span className="flex items-center gap-1">
            <ArrowDown className="h-3 w-3" />
            <span className="tabular-nums">{status.behind}</span>
          </span>
        ),
        variant: 'warning',
        tooltip: `${t('sync.status.behind', { count: status.behind })} · ${lastChecked}`,
      }
    }
    if (status.state === 'ahead') {
      const dirty = status.localChanges > 0 ? '*' : ''
      return {
        label: (
          <span className="flex items-center gap-1">
            <ArrowUp className="h-3 w-3" />
            <span className="tabular-nums">
              {status.ahead}
              {dirty}
            </span>
          </span>
        ),
        variant: 'info',
        tooltip: `${t('sync.status.ahead', { count: status.ahead })}${
          status.localChanges > 0
            ? ` + ${t('sync.status.localChanges', { count: status.localChanges })}`
            : ''
        } · ${lastChecked}`,
      }
    }
    // diverged
    const dirtyMark = status.localChanges > 0 ? '*' : ''
    return {
      label: (
        <span className="flex items-center gap-1">
          <ArrowDown className="h-3 w-3" />
          <span className="tabular-nums">{status.behind}</span>
          <span aria-hidden className="opacity-50">·</span>
          <ArrowUp className="h-3 w-3" />
          <span className="tabular-nums">
            {status.ahead}
            {dirtyMark}
          </span>
        </span>
      ),
      variant: 'destructive',
      tooltip: `${t('sync.status.divergedTooltip', { behind: status.behind, ahead: status.ahead })}${
        status.localChanges > 0
          ? ` + ${t('sync.status.localChanges', { count: status.localChanges })}`
          : ''
      } · ${lastChecked}`,
    }
  })()

  return (
    <button
      onClick={onRefresh}
      title={`${info.tooltip}\n${t('sync.status.refresh')}`}
      className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge variant={info.variant} className={cn('cursor-pointer hover:opacity-80')}>
        {info.label}
      </Badge>
    </button>
  )
}
