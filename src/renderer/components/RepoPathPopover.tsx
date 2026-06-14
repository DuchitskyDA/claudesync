import React, { useEffect, useRef } from 'react'
import type { GitDiagCmd } from '@shared/api'
import { useT } from '../i18n'
import { Button } from './ui/button'

type Props = {
  repoPath: string
  onRunDiag: (cmd: GitDiagCmd) => void
  onClose: () => void
}

const DIAGS: { cmd: GitDiagCmd; label: string }[] = [
  { cmd: 'status', label: 'git status' },
  { cmd: 'log', label: 'git log' },
  { cmd: 'show', label: 'HEAD --stat' },
  { cmd: 'remote', label: 'git remote' },
]

export function RepoPathPopover({ repoPath, onRunDiag, onClose }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-1 z-50 w-72 rounded-md border bg-popover p-3 text-xs shadow-md"
    >
      <div className="font-medium text-foreground">{t('statusBar.repo.popover.title')}</div>
      <div className="mt-0.5 text-muted-foreground">{t('statusBar.repo.popover.subtitle')}</div>
      <div className="mt-1 break-all font-mono text-[11px] text-foreground">{repoPath}</div>

      <div className="mt-2 text-muted-foreground">{t('statusBar.repo.popover.diagHeader')}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {DIAGS.map((d) => (
          <Button
            key={d.cmd}
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={() => onRunDiag(d.cmd)}
          >
            {d.label}
          </Button>
        ))}
      </div>

      <div className="mt-2 flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => void navigator.clipboard.writeText(repoPath).catch(() => {})}
        >
          {t('statusBar.repo.popover.copy')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => void window.api.openRepoFolder()}
        >
          {t('statusBar.repo.popover.open')}
        </Button>
      </div>
    </div>
  )
}
