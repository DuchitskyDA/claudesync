import React, { useEffect, useState } from 'react'
import type { RepoStatus } from '@shared/api'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (commitMessage: string, includeSecrets: boolean) => Promise<void>
}

export function PushModal({ open, onClose, onConfirm }: Props) {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [message, setMessage] = useState('')
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMessage('')
    setError(null)
    setBusy(false)
    void window.api.getRepoStatus().then(setStatus)
  }, [open])

  if (!open) return null

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(message.trim(), includeSecrets)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
      <div className="w-[540px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-3 text-base font-semibold">Push Local Changes</h2>

        {!status ? (
          <div className="text-sm text-neutral-500">Checking repo status…</div>
        ) : status.clean ? (
          <div className="rounded bg-neutral-100 p-3 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
            Nothing to push — local config matches the repo.
          </div>
        ) : (
          <>
            <div className="mb-3">
              <h3 className="mb-1 text-xs uppercase text-neutral-500">
                Changed files ({status.changedFiles.length})
              </h3>
              <div className="max-h-32 overflow-auto rounded border border-neutral-200 p-2 font-mono text-xs dark:border-neutral-700">
                {status.changedFiles.map((f) => (
                  <div key={f}>{f}</div>
                ))}
              </div>
            </div>

            <label className="mb-1 block text-xs text-neutral-500">Commit message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="What changed?"
              className="mb-3 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
            />

            <label className="mb-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSecrets}
                onChange={(e) => setIncludeSecrets(e.target.checked)}
              />
              <span>Include API keys in settings.json env</span>
            </label>
            {includeSecrets && (
              <div className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                ⚠ Only enable for PRIVATE repositories. Public repos will leak your keys to git history.
              </div>
            )}

            {error && <div className="mb-2 text-sm text-red-500">{error}</div>}
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Cancel
          </button>
          {!status?.clean && (
            <button
              onClick={handleConfirm}
              disabled={busy || message.trim() === ''}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
            >
              {busy ? 'Pushing…' : 'Push'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
