import React, { useEffect, useState } from 'react'
import type { GitHubAuthState } from '@shared/api'
import { DeviceFlowModal } from './DeviceFlowModal'

type Props = {
  open: boolean
  initial: { repoUrl: string | null; repoPath: string | null; rulesTarget: string | null }
  authState: GitHubAuthState | null
  onClose: () => void
  onSaved: (cfg: { repoUrl: string | null; repoPath: string | null; rulesTarget: string }) => void
  onSignOut: () => Promise<void>
  onSignedIn: () => void
}

export function Settings({ open, initial, authState, onClose, onSaved, onSignOut, onSignedIn }: Props) {
  const [url, setUrl] = useState(initial.repoUrl ?? '')
  const [path, setPath] = useState(initial.repoPath ?? '')
  const [target, setTarget] = useState(initial.rulesTarget ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [placeholderTarget, setPlaceholderTarget] = useState('')
  const [deviceFlowOpen, setDeviceFlowOpen] = useState(false)

  // Reset fields when modal re-opens with new initials
  useEffect(() => {
    if (open) {
      setUrl(initial.repoUrl ?? '')
      setPath(initial.repoPath ?? '')
      setTarget(initial.rulesTarget ?? '')
      setError(null)

      // Auto-detect target if user hasn't set one
      if (!initial.rulesTarget) {
        void window.api.detectRulesTarget().then((detected) => {
          if (detected) setTarget(detected)
        })
      }
      // Always fetch placeholder for the input
      void window.api.suggestRulesTarget().then(setPlaceholderTarget)
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

  const onUrlChange = async (newUrl: string) => {
    setUrl(newUrl)
    setError(null)
    if (newUrl.trim() && !path.trim()) {
      const suggested = await window.api.suggestRepoPath(newUrl)
      setPath(suggested)
    }
  }

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const trimmedUrl = url.trim()
      const trimmedTarget = target.trim()
      let finalPath: string | null = path.trim() || null
      if (trimmedUrl && !finalPath) {
        finalPath = await window.api.suggestRepoPath(trimmedUrl)
      }
      // If no URL — sync isn't needed; clear repoPath so we don't pin it to a fake suggestion
      if (!trimmedUrl) finalPath = null
      const r = await window.api.setConfig({
        repoUrl: trimmedUrl || null,
        repoPath: finalPath,
        rulesTarget: trimmedTarget || null,
        includeSecretsInPush: false,
      })
      if (!r.ok) {
        setError(r.error ?? 'Unknown error')
        return
      }
      onSaved({ repoUrl: trimmedUrl || null, repoPath: finalPath, rulesTarget: trimmedTarget })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // Rules target is required (for both sync and plugins). URL is optional — only needed for sync.
  const canSave = target.trim() !== ''

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40">
      <div className="w-[540px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-4 text-base font-semibold">Settings</h2>

        <label className="mb-1 block text-xs text-neutral-500">
          Repo URL <span className="text-neutral-400">(optional — only for Sync)</span>
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => { void onUrlChange(e.target.value) }}
          placeholder="https://github.com/user/ai-rules"
          className="mb-3 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />

        <label className="mb-1 block text-xs text-neutral-500">
          Rules target folder <span className="text-neutral-400">(required)</span>
        </label>
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={placeholderTarget || 'Path to your AI rules folder (e.g. ~/.claude)'}
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

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mb-2 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
        </button>

        {showAdvanced && (
          <div className="mb-3 rounded border border-neutral-200 p-3 dark:border-neutral-700">
            <label className="mb-1 block text-xs text-neutral-500">
              Local repo path <span className="text-neutral-400">(where to clone — auto-managed if empty)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Auto-managed by app"
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
          </div>
        )}

        {error && <div className="mb-2 text-sm text-red-500">{error}</div>}

        <div className="my-4 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <h3 className="mb-2 text-xs uppercase text-neutral-500">GitHub</h3>
          {authState?.authenticated ? (
            <div className="flex items-center gap-2 text-sm">
              <span>
                Signed in as <strong>@{authState.login}</strong>
              </span>
              <button
                onClick={() => void onSignOut()}
                className="text-xs text-neutral-500 hover:underline"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeviceFlowOpen(true)}
              className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-700"
            >
              Sign in with GitHub
            </button>
          )}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !canSave}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
          >
            Save
          </button>
        </div>
      </div>
      <DeviceFlowModal
        open={deviceFlowOpen}
        onClose={() => setDeviceFlowOpen(false)}
        onSuccess={() => {
          setDeviceFlowOpen(false)
          onSignedIn()
        }}
      />
    </div>
  )
}
