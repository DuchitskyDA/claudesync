import React from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import type { UpdaterFlowState } from '../hooks/useAppState'
import { useT } from '../i18n'

type Props = {
  flow: UpdaterFlowState
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
      <div className="space-y-3">
        <Spinner label={t('updater.modal.pleaseWait')} />
        {flow.percent > 0 && (
          <div>
            <Progress value={flow.percent} />
            <div className="mt-1 text-right font-mono text-xs tabular-nums text-muted-foreground">
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
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      )
    } else {
      body = <div className="text-sm">{t('updater.modal.readyToInstall')}</div>
      actions = (
        <>
          <Button variant="outline" onClick={onClose}>
            {t('updater.modal.installLater')}
          </Button>
          <Button onClick={onInstallNow}>{t('updater.modal.installAndRestart')}</Button>
        </>
      )
    }
  } else {
    title = t('updater.modal.error')
    body = (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
        {flow.message}
      </div>
    )
    actions = (
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[440px]" hideClose>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="py-1">{body}</div>
        {actions && <DialogFooter className="sm:justify-end gap-2">{actions}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span>{label}</span>
    </div>
  )
}
