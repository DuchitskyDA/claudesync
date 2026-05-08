import React, { useEffect, useState } from 'react'
import type { RepoStatus } from '@shared/api'
import { useT } from '../i18n'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (commitMessage: string, includeSecrets: boolean) => Promise<void>
}

const inputCls =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100'

const ghostBtnCls =
  'rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'

export function PushModal({ open, onClose, onConfirm }: Props) {
  const t = useT()
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
    void window.api.getConfig().then((cfg) => setIncludeSecrets(cfg.includeSecretsInPush))
  }, [open])

  if (!open) return null

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const cfg = await window.api.getConfig()
      await window.api.setConfig({ ...cfg, includeSecretsInPush: includeSecrets })
      await onConfirm(message.trim(), includeSecrets)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[88vh] w-[560px] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <h2 className="font-display text-base font-semibold tracking-tight">
            {t('push.modal.title')}
          </h2>
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
          {!status ? (
            <div className="text-sm text-neutral-500">{t('push.modal.checkingStatus')}</div>
          ) : status.clean ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              {t('push.info.nothingToPush')}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {t('push.modal.changedFiles', { count: status.changedFiles.length })}
                </h3>
                <div className="max-h-32 overflow-auto rounded-md border border-neutral-200 p-2 font-mono text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                  {status.changedFiles.map((f) => (
                    <div key={f} className="truncate">{f}</div>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  {t('push.modal.commitMessage.label')}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  placeholder={t('push.modal.commitMessage.placeholder')}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeSecrets}
                    onChange={(e) => setIncludeSecrets(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{t('push.modal.includeSecrets.label')}</span>
                </label>
                {includeSecrets && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {t('push.modal.includeSecrets.warning')}
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <button onClick={onClose} className={ghostBtnCls}>
            {t('common.cancel')}
          </button>
          {!status?.clean && (
            <button
              onClick={handleConfirm}
              disabled={busy || message.trim() === ''}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none dark:disabled:bg-neutral-700"
            >
              {busy ? t('push.modal.pushing') : t('push.modal.push')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
