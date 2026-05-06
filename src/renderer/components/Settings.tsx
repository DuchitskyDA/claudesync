import React, { useEffect, useState } from 'react'

type Props = {
  open: boolean
  initial: { repoUrl: string | null; repoPath: string | null; rulesTarget: string | null }
  onClose: () => void
  onSaved: (cfg: { repoUrl: string; repoPath: string; rulesTarget: string }) => void
}

export function Settings({ open, initial, onClose, onSaved }: Props) {
  const [url, setUrl] = useState(initial.repoUrl ?? '')
  const [path, setPath] = useState(initial.repoPath ?? '')
  const [target, setTarget] = useState(initial.rulesTarget ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset fields when modal re-opens with new initials
  useEffect(() => {
    if (open) {
      setUrl(initial.repoUrl ?? '')
      setPath(initial.repoPath ?? '')
      setTarget(initial.rulesTarget ?? '')
      setError(null)
    }
  }, [open, initial.repoUrl, initial.repoPath, initial.rulesTarget])

  if (!open) return null

  const browse = async (setter: (s: string) => void) => {
    const picked = await window.api.pickRepoPath()
    if (picked) {
      setter(picked)
      setError(null)
    }
  }

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await window.api.setConfig({ repoUrl: url, repoPath: path, rulesTarget: target })
      if (!r.ok) {
        setError(r.error ?? 'Unknown error')
        return
      }
      onSaved({ repoUrl: url, repoPath: path, rulesTarget: target })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const allFilled = url.trim() !== '' && path.trim() !== '' && target.trim() !== ''

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40">
      <div className="w-[540px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-4 text-base font-semibold">Settings</h2>

        <label className="mb-1 block text-xs text-neutral-500">Repo URL (https or git@)</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/user/ai-rules"
          className="mb-3 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />

        <label className="mb-1 block text-xs text-neutral-500">Local repo path</label>
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/where/to/clone"
            className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          />
          <button
            type="button"
            onClick={() => browse(setPath)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-700"
          >
            Browse…
          </button>
        </div>

        <label className="mb-1 block text-xs text-neutral-500">Rules target folder</label>
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="~/.claude or ~/.cursor — where install script links files"
            className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          />
          <button
            type="button"
            onClick={() => browse(setTarget)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-700"
          >
            Browse…
          </button>
        </div>

        {error && <div className="mb-2 text-sm text-red-500">{error}</div>}

        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !allFilled}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
