import React, { useEffect, useRef, useState } from 'react'
import type { DeviceFlowChallenge } from '@shared/api'

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
      if (result.error === 'authorization_pending' || result.error === 'slow_down') {
        if (result.error === 'slow_down') intervalRef.current += 5
        cancelTimer()
        // If we showed verifying state for a manual click — return to waiting view with the saved challenge
        if (manual && lastChallengeRef.current) {
          setState({ phase: 'waiting', challenge: lastChallengeRef.current })
        }
        timerRef.current = setTimeout(() => void doPoll(false), intervalRef.current * 1000)
      } else {
        setState({ phase: 'error', error: `Authorization failed: ${result.error}` })
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
      <div className="w-[480px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-3 text-base font-semibold">Sign in to GitHub</h2>

        {state.phase === 'starting' && (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-500" />
            Requesting code from GitHub…
          </div>
        )}

        {state.phase === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-neutral-600 dark:text-neutral-300">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-blue-500 dark:border-neutral-700" />
            <div>Verifying with GitHub…</div>
            <div className="text-xs text-neutral-500">This usually takes 2-4 seconds</div>
          </div>
        )}

        {state.phase === 'success' && (
          <div className="flex flex-col items-center gap-2 py-6 text-emerald-500">
            <span className="text-3xl">✓</span>
            <div className="text-sm font-medium">Signed in</div>
          </div>
        )}

        {state.phase === 'waiting' && (
          <>
            <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
              <strong>1.</strong> Open{' '}
              <button
                onClick={() => handleOpenBrowser(state.challenge.verificationUri)}
                className="text-blue-500 hover:underline"
              >
                {state.challenge.verificationUri}
              </button>{' '}
              in your browser
            </p>
            <p className="mb-2 text-sm">
              <strong>2.</strong> Enter this code (click to copy):
            </p>
            <button
              onClick={() => void handleCopyCode(state.challenge.userCode)}
              className="mb-1 w-full rounded bg-neutral-100 p-3 text-center font-mono text-lg tracking-wider hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-700"
            >
              {state.challenge.userCode}
            </button>
            <div className="mb-3 h-4 text-center text-xs text-emerald-500">
              {copied ? '✓ Copied' : ''}
            </div>
            <p className="mb-3 text-sm">
              <strong>3.</strong> After authorizing in browser, click below:
            </p>
            <button
              onClick={() => void doPoll(true)}
              disabled={checking}
              className="mb-2 w-full rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
            >
              {checking ? 'Checking…' : "I've authorized — check now"}
            </button>
            <div className="text-center text-xs text-neutral-500">
              Or wait — auto-checks every {intervalRef.current}s
            </div>
          </>
        )}

        {state.phase === 'error' && (
          <div className="mb-2 text-sm text-red-500">{state.error}</div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
