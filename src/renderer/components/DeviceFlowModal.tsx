import React, { useEffect, useRef, useState } from 'react'
import type { DeviceFlowChallenge } from '@shared/api'
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
        // brief success flash then close
        setTimeout(() => onSuccess(), 600)
        return
      }
      const errorKey = result.error?.key ?? ''
      const isPending = errorKey === 'auth.error.authorization_pending'
      const isSlowDown = errorKey === 'auth.error.slow_down'
      if (isPending || isSlowDown) {
        if (isSlowDown) intervalRef.current += 5
        cancelTimer()
        // If we showed verifying state for a manual click — return to waiting view with the saved challenge
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

  if (!open) return null

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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[88vh] w-[480px] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <h2 className="font-display text-base font-semibold tracking-tight">{t('deviceFlow.title')}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.phase === 'starting' && (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-500" />
              {t('deviceFlow.starting')}
            </div>
          )}

          {state.phase === 'verifying' && (
            <div className="flex flex-col items-center gap-3 py-6 text-sm text-neutral-600 dark:text-neutral-300">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-blue-500 dark:border-neutral-700" />
              <div>{t('deviceFlow.verifying')}</div>
              <div className="text-xs text-neutral-500">{t('deviceFlow.verifyingHint')}</div>
            </div>
          )}

          {state.phase === 'success' && (
            <div className="flex flex-col items-center gap-2 py-6 text-emerald-500">
              <span className="text-3xl">✓</span>
              <div className="text-sm font-medium">{t('deviceFlow.success')}</div>
            </div>
          )}

          {state.phase === 'waiting' && (
            <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
              <p>
                <strong>1.</strong> {t('deviceFlow.step1.before')}{' '}
                <button
                  onClick={() => handleOpenBrowser(state.challenge.verificationUri)}
                  className="font-mono text-blue-500 hover:underline"
                >
                  {state.challenge.verificationUri}
                </button>{' '}
                {t('deviceFlow.step1.after')}
              </p>
              <p>
                <strong>2.</strong> {t('deviceFlow.step2')}
              </p>
              <button
                onClick={() => void handleCopyCode(state.challenge.userCode)}
                className="w-full rounded-md border border-neutral-200 bg-neutral-50 p-3 text-center font-mono text-lg tracking-[0.25em] text-neutral-900 transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-700"
              >
                {state.challenge.userCode}
              </button>
              <div className="h-4 text-center text-xs text-emerald-500">
                {copied ? t('deviceFlow.copied') : ''}
              </div>
              <p>
                <strong>3.</strong> {t('deviceFlow.step3')}
              </p>
              <button
                onClick={() => void doPoll(true)}
                disabled={checking}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none dark:disabled:bg-neutral-700"
              >
                {checking ? t('deviceFlow.checking') : t('deviceFlow.checkNow')}
              </button>
              <div className="text-center text-xs text-neutral-500">
                {t('deviceFlow.autoCheck', { interval: intervalRef.current })}
              </div>
            </div>
          )}

          {state.phase === 'error' && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {state.error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <button
            onClick={onClose}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
