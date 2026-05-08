import React from 'react'
import type { ConflictFile, ConflictResolveChoice } from '@shared/api'
import { useT } from '../i18n'

type Props = {
  files: ConflictFile[]
  selectedPath: string | null
  busyPath: string | null
  onSelect: (path: string) => void
  onResolve: (path: string, choice: ConflictResolveChoice) => void
  onOpenInEditor: (path: string) => void
}

const STATUS_CLASS: Record<ConflictFile['status'], string> = {
  unresolved: 'text-red-500',
  'resolved-mine': 'text-emerald-600',
  'resolved-remote': 'text-emerald-600',
  'resolved-manual': 'text-emerald-600',
}

const actionBtnCls =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'

export function ConflictFileList({
  files,
  selectedPath,
  busyPath,
  onSelect,
  onResolve,
  onOpenInEditor,
}: Props) {
  const t = useT()
  const unresolvedCount = files.filter((f) => f.status === 'unresolved').length

  return (
    <div className="flex h-full w-72 flex-col border-r border-neutral-200 dark:border-neutral-700">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {t('conflict.fileList.title')}
        </div>
        <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
          {unresolvedCount === 0
            ? t('conflict.fileList.allResolved')
            : t('conflict.fileList.unresolved', { count: unresolvedCount })}
        </div>
      </div>
      <ul className="flex-1 overflow-auto">
        {files.map((f) => {
          const isSelected = f.path === selectedPath
          const isBusy = busyPath === f.path
          return (
            <li
              key={f.path}
              className={`border-b border-neutral-200 px-3 py-2 dark:border-neutral-700 ${
                isSelected ? 'bg-blue-50 dark:bg-blue-950' : ''
              }`}
            >
              <button
                onClick={() => onSelect(f.path)}
                className="block w-full truncate text-left font-mono text-xs text-neutral-900 hover:underline dark:text-neutral-100"
              >
                {f.path}
              </button>
              <div className={`mt-0.5 text-xs ${STATUS_CLASS[f.status]}`}>
                {t(`conflict.fileList.status.${f.status}`)}
              </div>
              {f.status === 'unresolved' && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button
                    disabled={isBusy || f.binary}
                    onClick={() => onResolve(f.path, 'mine')}
                    className={actionBtnCls}
                  >
                    {t('conflict.fileList.useMine')}
                  </button>
                  <button
                    disabled={isBusy || f.binary}
                    onClick={() => onResolve(f.path, 'remote')}
                    className={actionBtnCls}
                  >
                    {t('conflict.fileList.useRemote')}
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => onOpenInEditor(f.path)}
                    className={actionBtnCls}
                  >
                    {t('conflict.fileList.openInEditor')}
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => onResolve(f.path, 'manual')}
                    className={actionBtnCls}
                  >
                    {t('conflict.fileList.markResolved')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
