import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SyncStatus } from '@shared/api'
import { Loader2, AlertTriangle, ArrowDown, ArrowUp, Check, Circle, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '../i18n'

type Props = {
  status: SyncStatus
  checking: boolean
  onRefresh: () => void
  onPush: () => void
  onPull: () => void
  onResolve: () => void
  onDiscard: () => Promise<void> | void
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
      className: 'text-foreground/80',
      hasChanges: true,
    }
  }
  if (status.state === 'behind') {
    return {
      icon: <ArrowDown className="h-3 w-3" />,
      text: String(status.behind),
      className: 'text-foreground/80',
      hasChanges: true,
    }
  }
  if (status.state === 'ahead') {
    return {
      icon: <ArrowUp className="h-3 w-3" />,
      text: String(status.ahead),
      className: 'text-foreground/80',
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
    className: 'text-amber-600 dark:text-amber-500',
    hasChanges: true,
  }
}

const POPOVER_WIDTH = 320
const POPOVER_GAP = 6

export function SyncStatusIndicator({ status, checking, onRefresh, onPush, onPull, onResolve, onDiscard }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  useEffect(() => {
    if (!open) {
      setConfirmingDiscard(false)
      return
    }
    void window.api.getRepoStatus().then((s) => setFiles([...s.added, ...s.modified, ...s.deletions, ...s.unreadable]))
  }, [open, status])

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

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    // Anchor popover bottom-edge above the button, left-edge near the button
    // but clamped to stay inside the viewport.
    const viewportWidth = window.innerWidth
    const desiredLeft = rect.left
    const maxLeft = viewportWidth - POPOVER_WIDTH - 8
    const left = Math.max(8, Math.min(desiredLeft, maxLeft))
    const bottom = window.innerHeight - rect.top + POPOVER_GAP
    setCoords({ left, bottom })
  }, [open, status])

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

  const isDiverged = status.state === 'diverged'
  const showResolveAction = isDiverged
  const showPushAction =
    !isDiverged && (status.state === 'ahead' || status.state === 'local-changes')
  const showPullAction = !isDiverged && status.state === 'behind'

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

      {open && visual.hasChanges && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              left: coords.left,
              bottom: coords.bottom,
              width: POPOVER_WIDTH,
              zIndex: 50,
            }}
            className="rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
          >
            <StateSummary status={status} />

            {files.length > 0 && (
              <div className="mt-2 max-h-40 overflow-auto rounded border bg-secondary/40 p-1.5 font-mono text-[10px] leading-tight">
                {files.slice(0, 50).map((f) => (
                  <button
                    key={f}
                    onClick={() => void window.api.openRepoFile(f)}
                    className="block whitespace-nowrap rounded px-1 py-0.5 text-left transition hover:bg-accent hover:text-foreground"
                    title={t('sync.popover.openFile', { path: f })}
                  >
                    {f}
                  </button>
                ))}
                {files.length > 50 && (
                  <div className="whitespace-nowrap px-1 text-muted-foreground">
                    {t('sync.popover.moreFiles', { count: files.length - 50 })}
                  </div>
                )}
              </div>
            )}

            {confirmingDiscard ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-foreground">{t('sync.popover.discardConfirm')}</p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setConfirmingDiscard(false)}
                    disabled={discarding}
                    className="rounded px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={async () => {
                      setDiscarding(true)
                      try {
                        await onDiscard()
                      } finally {
                        setDiscarding(false)
                        setConfirmingDiscard(false)
                        setOpen(false)
                      }
                    }}
                    disabled={discarding}
                    className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground transition hover:opacity-90 disabled:opacity-60"
                  >
                    {discarding ? t('sync.popover.discarding') : t('sync.popover.discardConfirmYes')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between gap-2">
                {status.localChanges > 0 ? (
                  <button
                    onClick={() => setConfirmingDiscard(true)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    title={t('sync.popover.discardTitle')}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('sync.popover.discard')}
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
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
                      className="rounded border bg-secondary px-2 py-1 text-xs text-secondary-foreground transition hover:bg-accent"
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
                      className="rounded border bg-secondary px-2 py-1 text-xs text-secondary-foreground transition hover:bg-accent"
                    >
                      {t('sync.popover.push')}
                    </button>
                  )}
                  {showResolveAction && (
                    <button
                      onClick={() => {
                        onResolve()
                        setOpen(false)
                      }}
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-400"
                    >
                      {t('sync.diverged.resolve')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>,
          document.body,
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
      cls: 'text-foreground',
    })
  }
  if (status.ahead > 0) {
    lines.push({
      label: t('sync.popover.outgoing'),
      value: status.ahead,
      cls: 'text-foreground',
    })
  }
  if (status.localChanges > 0) {
    lines.push({
      label: t('sync.popover.localChanges'),
      value: status.localChanges,
      cls: 'text-foreground',
    })
  }
  const foreignCount = status.foreignPaths?.length ?? 0
  return (
    <div className="space-y-1">
      {lines.map((l) => (
        <div key={l.label} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{l.label}</span>
          <span className={cn('tabular-nums font-medium', l.cls)}>{l.value}</span>
        </div>
      ))}
      {foreignCount > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-amber-600 dark:text-amber-500">{t('sync.popover.foreignPaths')}</span>
          <span className="tabular-nums font-medium text-amber-600 dark:text-amber-500">{foreignCount}</span>
        </div>
      )}
    </div>
  )
}
