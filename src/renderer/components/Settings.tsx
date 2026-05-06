import React, { useState } from 'react'

type Props = {
  open: boolean
  initialRepoPath: string | null
  onClose: () => void
  onSaved: (repoPath: string) => void
}

export function Settings({ open, initialRepoPath, onClose, onSaved }: Props) {
  const [path, setPath] = useState(initialRepoPath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const browse = async () => {
    const picked = await window.api.pickRepoPath()
    if (picked) {
      setPath(picked)
      setError(null)
    }
  }

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await window.api.setConfig({ repoPath: path, repoUrl: null, rulesTarget: null })
      if (!r.ok) {
        setError(r.error ?? 'Unknown error')
        return
      }
      onSaved(path)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-3 text-base font-semibold">Settings</h2>
        <label className="mb-1 block text-xs text-neutral-500">Path to ai-config repo</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/ai"
            className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          />
          <button
            onClick={browse}
            type="button"
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-700"
          >
            Browse…
          </button>
        </div>
        {error && <div className="mt-2 text-sm text-red-500">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || path.trim() === ''}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
