import React, { useEffect, useRef, useState } from 'react'
import type { DeviceFlowChallenge } from '@shared/api'
import { Loader2, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { useT } from '../i18n'

type Props = {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type State =
  | { phase: 'starting' }
  | { phase: 'waiting'; challenge: DeviceFlowChallenge }
  | { phase: 'verifying' }
  | { phase: 'success' }
  | { phase: 'error'; error: string }

const MIN_POLL_INTERVAL_SEC = 3

export function DeviceFlowModal({ open, onClose, onSuccess }: Props) {
  const t = useT()
  const [state, setState] = useState<State>({ phase: 'starting' })
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  const pollingRef = useRef(false)
  const intervalRef = useRef(MIN_POLL_INTERVAL_SEC)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastChallengeRef = useRef<DeviceFlowChallenge | null>(null)

  const cancelTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const doPoll = async (manual = false): Promise<void> => {
    if (!pollingRef.current) return
    if (manual) {
      setChecking(true)
      setState({ phase: 'verifying' })
    }
    try {
      const result = await window.api.pollDeviceFlow()
      if (!pollingRef.current) return
      if (result.ok) {
        cancelTimer()
        pollingRef.current = false
        setState({ phase: 'success' })
        setTimeout(() => onSuccess(), 600)
        return
      }
      const errorKey = result.error?.key ?? ''
      const isPending = errorKey === 'auth.error.authorization_pending'
      const isSlowDown = errorKey === 'auth.error.slow_down'
      if (isPending || isSlowDown) {
        if (isSlowDown) intervalRef.current += 5
        cancelTimer()
        if (manual && lastChallengeRef.current) {
          setState({ phase: 'waiting', challenge: lastChallengeRef.current })
        }
        timerRef.current = setTimeout(() => void doPoll(false), intervalRef.current * 1000)
      } else {
        const errText = result.error?.fallback ?? result.error?.key ?? 'unknown error'
        setState({ phase: 'error', error: `Authorization failed: ${errText}` })
      }
    } catch (e) {
      setState({ phase: 'error', error: `Poll error: ${(e as Error).message}` })
    } finally {
      if (manual) setChecking(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setState({ phase: 'starting' })
    setCopied(false)
    pollingRef.current = true
    intervalRef.current = MIN_POLL_INTERVAL_SEC

    void window.api
      .startDeviceFlow()
      .then((challenge) => {
        if (!pollingRef.current) return
        intervalRef.current = Math.max(challenge.interval, MIN_POLL_INTERVAL_SEC)
        lastChallengeRef.current = challenge
        setState({ phase: 'waiting', challenge })
        timerRef.current = setTimeout(() => void doPoll(false), intervalRef.current * 1000)
      })
      .catch((e: Error) => setState({ phase: 'error', error: e.message }))

    return () => {
      pollingRef.current = false
      cancelTimer()
      void window.api.cancelDeviceFlow()
    }
  }, [open])

  const handleOpenBrowser = (url: string) => {
    void window.api.openExternal(url)
  }

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('deviceFlow.title')}</DialogTitle>
        </DialogHeader>

        {state.phase === 'starting' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('deviceFlow.starting')}
          </div>
        )}

        {state.phase === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div>{t('deviceFlow.verifying')}</div>
            <div className="text-xs">{t('deviceFlow.verifyingHint')}</div>
          </div>
        )}

        {state.phase === 'success' && (
          <div className="flex flex-col items-center gap-2 py-6 text-emerald-500">
            <Check className="h-8 w-8" />
            <div className="text-sm font-medium">{t('deviceFlow.success')}</div>
          </div>
        )}

        {state.phase === 'waiting' && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>1.</strong> {t('deviceFlow.step1.before')}{' '}
              <button
                onClick={() => handleOpenBrowser(state.challenge.verificationUri)}
                className="font-mono text-primary hover:underline"
              >
                {state.challenge.verificationUri}
              </button>{' '}
              {t('deviceFlow.step1.after')}
            </p>
            <p><strong>2.</strong> {t('deviceFlow.step2')}</p>
            <button
              onClick={() => void handleCopyCode(state.challenge.userCode)}
              className="w-full rounded-md border bg-muted/40 p-3 text-center font-mono text-lg tracking-[0.25em] transition hover:bg-muted"
            >
              {state.challenge.userCode}
            </button>
            <div className="h-4 text-center text-xs text-emerald-500">
              {copied ? t('deviceFlow.copied') : ''}
            </div>
            <p><strong>3.</strong> {t('deviceFlow.step3')}</p>
            <Button
              onClick={() => void doPoll(true)}
              disabled={checking}
              className="w-full"
            >
              {checking ? t('deviceFlow.checking') : t('deviceFlow.checkNow')}
            </Button>
            <div className="text-center text-xs text-muted-foreground">
              {t('deviceFlow.autoCheck', { interval: intervalRef.current })}
            </div>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </div>
        )}

        <DialogFooter className="sm:justify-end">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
