import React from 'react'
import type { UpdaterFlowState } from '../hooks/useAppState'
import { useT } from '../i18n'

type Props = {
  flow: UpdaterFlowState
  /** kind === 'brew' restarts itself; on 'auto' the user clicks Install & Restart. */
  kind: 'auto' | 'brew' | 'none' | 'unknown'
  onClose: () => void
  onInstallNow: () => void
}

export function UpdateProgressModal({ flow, kind, onClose, onInstallNow }: Props) {
  const t = useT()

  if (flow.phase === 'idle') return null

  let title: string
  let body: React.ReactNode
  let actions: React.ReactNode = null

  if (flow.phase === 'checking') {
    title = t('updater.modal.checking')
    body = <Spinner label={t('updater.modal.connecting')} />
  } else if (flow.phase === 'downloading') {
    title = t('updater.modal.downloading')
    body = (
      <div>
        <Spinner label={t('updater.modal.pleaseWait')} />
        {flow.percent > 0 && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div
                className="h-full bg-blue-500 transition-all duration-200"
                style={{ width: `${flow.percent}%` }}
              />
            </div>
            <div className="mt-1 text-right font-mono text-xs tabular-nums text-neutral-500">
              {flow.percent}%
            </div>
          </div>
        )}
      </div>
    )
  } else if (flow.phase === 'ready') {
    title = t('updater.modal.ready')
    if (kind === 'brew') {
      body = <div className="text-sm">{t('updater.modal.brewSucceeded')}</div>
      actions = (
        <button
          onClick={onClose}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          {t('common.cancel')}
        </button>
      )
    } else {
      body = <div className="text-sm">{t('updater.modal.readyToInstall')}</div>
      actions = (
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {t('updater.modal.installLater')}
          </button>
          <button
            onClick={onInstallNow}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            {t('updater.modal.installAndRestart')}
          </button>
        </>
      )
    }
  } else {
    // error
    title = t('updater.modal.error')
    body = (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {flow.message}
      </div>
    )
    actions = (
      <button
        onClick={onClose}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        {t('common.cancel')}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="flex w-[440px] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-neutral-800">
        <div className="border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
        </div>
        <div className="px-5 py-4">{body}</div>
        {actions && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-700">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-300">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-500 dark:border-neutral-600 dark:border-t-blue-400" />
      <span>{label}</span>
    </div>
  )
}
