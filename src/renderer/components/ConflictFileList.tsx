import React from 'react'
import type { ConflictFile, ConflictResolveChoice } from '@shared/api'
import { Button } from './ui/button'
import { useT } from '../i18n'
import { cn } from '@/lib/utils'

type Props = {
  files: ConflictFile[]
  selectedPath: string | null
  busyPath: string | null
  onSelect: (path: string) => void
  onResolve: (path: string, choice: ConflictResolveChoice) => void
  onOpenInEditor: (path: string) => void
}

const STATUS_CLASS: Record<ConflictFile['status'], string> = {
  unresolved: 'text-destructive',
  'resolved-mine': 'text-emerald-600 dark:text-emerald-400',
  'resolved-remote': 'text-emerald-600 dark:text-emerald-400',
  'resolved-manual': 'text-emerald-600 dark:text-emerald-400',
}

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
    <div className="flex h-full w-72 flex-col border-r">
      <div className="border-b bg-muted/40 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('conflict.fileList.title')}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
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
              className={cn('border-b px-3 py-2', isSelected && 'bg-accent')}
            >
              <button
                onClick={() => onSelect(f.path)}
                className="block w-full truncate text-left font-mono text-xs hover:underline"
              >
                {f.path}
              </button>
              <div className={cn('mt-0.5 text-xs', STATUS_CLASS[f.status])}>
                {t(`conflict.fileList.status.${f.status}`)}
              </div>
              {f.status === 'unresolved' && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isBusy || f.binary}
                    onClick={() => onResolve(f.path, 'mine')}
                  >
                    {t('conflict.fileList.useMine')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isBusy || f.binary}
                    onClick={() => onResolve(f.path, 'remote')}
                  >
                    {t('conflict.fileList.useRemote')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isBusy}
                    onClick={() => onOpenInEditor(f.path)}
                  >
                    {t('conflict.fileList.openInEditor')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isBusy}
                    onClick={() => onResolve(f.path, 'manual')}
                  >
                    {t('conflict.fileList.markResolved')}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
