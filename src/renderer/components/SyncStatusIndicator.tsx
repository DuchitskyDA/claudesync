import React, { useEffect, useRef, useState } from 'react'
import type { SyncStatus } from '@shared/api'
import { Loader2, AlertTriangle, ArrowDown, ArrowUp, Check, Circle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '../i18n'

type Props = {
  status: SyncStatus
  checking: boolean
  onRefresh: () => void
  onPush: () => void
  onPull: () => void
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

type Visual = {
  icon: React.ReactNode
  text: string | null
  className: string
  hasChanges: boolean
}

function getVisual(status: SyncStatus, checking: boolean): Visual {
  if (checking) {
    return {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      text: null,
      className: 'text-muted-foreground',
      hasChanges: false,
    }
  }
  if (status.state === 'offline') {
    return {
      icon: <AlertTriangle className="h-3 w-3" />,
      text: null,
      className: 'text-amber-600 dark:text-amber-500',
      hasChanges: false,
    }
  }
  if (status.state === 'unknown' || status.state === 'no-remote') {
    return {
      icon: <Circle className="h-2.5 w-2.5" />,
      text: null,
      className: 'text-muted-foreground/50',
      hasChanges: false,
    }
  }
  if (status.state === 'in-sync') {
    return {
      icon: <Check className="h-3 w-3" />,
      text: null,
      className: 'text-muted-foreground',
      hasChanges: false,
    }
  }
  if (status.state === 'local-changes') {
    return {
      icon: <Circle className="h-2.5 w-2.5 fill-current" />,
      text: String(status.localChanges),
      className: 'text-sky-600 dark:text-sky-500',
      hasChanges: true,
    }
  }
  if (status.state === 'behind') {
    return {
      icon: <ArrowDown className="h-3 w-3" />,
      text: String(status.behind),
      className: 'text-sky-600 dark:text-sky-500',
      hasChanges: true,
    }
  }
  if (status.state === 'ahead') {
    return {
      icon: <ArrowUp className="h-3 w-3" />,
      text: String(status.ahead),
      className: 'text-sky-600 dark:text-sky-500',
      hasChanges: true,
    }
  }
  // diverged
  return {
    icon: (
      <span className="flex items-center gap-0.5">
        <ArrowDown className="h-3 w-3" />
        <ArrowUp className="h-3 w-3" />
      </span>
    ),
    text: `${status.behind}/${status.ahead}`,
    className: 'text-rose-600 dark:text-rose-500',
    hasChanges: true,
  }
}

export function SyncStatusIndicator({ status, checking, onRefresh, onPush, onPull }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (status.state === 'no-remote') return null

  const visual = getVisual(status, checking)
  const lastChecked = formatRelative(t, status.fetchedAt)

  const handleClick = () => {
    if (!visual.hasChanges) {
      // Nothing pending — refresh immediately.
      onRefresh()
      return
    }
    setOpen((v) => !v)
  }

  const showPushAction =
    status.state === 'ahead' ||
    status.state === 'local-changes' ||
    status.state === 'diverged'
  const showPullAction = status.state === 'behind' || status.state === 'diverged'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleClick}
        title={`${lastChecked}${visual.hasChanges ? '' : ` · ${t('sync.status.refresh')}`}`}
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition hover:bg-accent',
          visual.className,
        )}
      >
        {visual.icon}
        {visual.text && <span className="tabular-nums">{visual.text}</span>}
      </button>

      {open && visual.hasChanges && (
        <div
          ref={popoverRef}
          className="absolute bottom-full right-0 z-50 mb-1 w-64 rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <StateSummary status={status} />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                onRefresh()
                setOpen(false)
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              {t('sync.popover.refresh')}
            </button>
            {showPullAction && (
              <button
                onClick={() => {
                  onPull()
                  setOpen(false)
                }}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground transition hover:opacity-90"
              >
                {t('sync.popover.pull')}
              </button>
            )}
            {showPushAction && (
              <button
                onClick={() => {
                  onPush()
                  setOpen(false)
                }}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground transition hover:opacity-90"
              >
                {t('sync.popover.push')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StateSummary({ status }: { status: SyncStatus }) {
  const t = useT()
  const lines: { label: string; value: number; cls: string }[] = []
  if (status.behind > 0) {
    lines.push({
      label: t('sync.popover.incoming'),
      value: status.behind,
      cls: 'text-sky-600 dark:text-sky-500',
    })
  }
  if (status.ahead > 0) {
    lines.push({
      label: t('sync.popover.outgoing'),
      value: status.ahead,
      cls: 'text-sky-600 dark:text-sky-500',
    })
  }
  if (status.localChanges > 0) {
    lines.push({
      label: t('sync.popover.localChanges'),
      value: status.localChanges,
      cls: 'text-sky-600 dark:text-sky-500',
    })
  }
  return (
    <div className="space-y-1">
      {lines.map((l) => (
        <div key={l.label} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{l.label}</span>
          <span className={cn('tabular-nums font-medium', l.cls)}>{l.value}</span>
        </div>
      ))}
    </div>
  )
}
