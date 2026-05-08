import React, { useEffect, useState } from 'react'
import type { DeviceFlowChallenge } from '@shared/api'

type Props = {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type State =
  | { phase: 'starting' }
  | { phase: 'waiting'; challenge: DeviceFlowChallenge }
  | { phase: 'error'; error: string }

export function DeviceFlowModal({ open, onClose, onSuccess }: Props) {
  const [state, setState] = useState<State>({ phase: 'starting' })

  useEffect(() => {
    if (!open) return
    setState({ phase: 'starting' })
    let polling = true
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let intervalSec = 5

    const poll = async () => {
      if (!polling) return
      const result = await window.api.pollDeviceFlow()
      if (!polling) return
      if (result.ok) {
        onSuccess()
        return
      }
      if (result.error === 'authorization_pending' || result.error === 'slow_down') {
        if (result.error === 'slow_down') intervalSec += 5
        pollTimer = setTimeout(poll, intervalSec * 1000)
      } else {
        setState({ phase: 'error', error: `Authorization failed: ${result.error}` })
      }
    }

    void window.api
      .startDeviceFlow()
      .then((challenge) => {
        if (!polling) return
        intervalSec = challenge.interval
        setState({ phase: 'waiting', challenge })
        pollTimer = setTimeout(poll, intervalSec * 1000)
      })
      .catch((e: Error) => setState({ phase: 'error', error: e.message }))

    return () => {
      polling = false
      if (pollTimer) clearTimeout(pollTimer)
      void window.api.cancelDeviceFlow()
    }
  }, [open, onSuccess])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-3 text-base font-semibold">Sign in to GitHub</h2>

        {state.phase === 'starting' && (
          <div className="text-sm text-neutral-500">Requesting code…</div>
        )}

        {state.phase === 'waiting' && (
          <>
            <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
              1. Open <strong>{state.challenge.verificationUri}</strong>
              <button
                onClick={() => window.open(state.challenge.verificationUri, '_blank')}
                className="ml-2 text-blue-500 hover:underline"
              >
                Open in browser
              </button>
            </p>
            <p className="mb-3 text-sm">2. Enter this code:</p>
            <div className="mb-4 rounded bg-neutral-100 p-3 text-center font-mono text-lg dark:bg-neutral-900">
              {state.challenge.userCode}
            </div>
            <div className="text-xs text-neutral-500">Waiting for authorization…</div>
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
