import React, { useState } from 'react'
import type { PullPreviewResult } from '@shared/api'
import type { PreviewItem } from '@shared/sync-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { useT } from '../i18n'

type Props = {
  open: boolean
  preview: PullPreviewResult | null
  onClose: () => void
  onApply: (deletionsToApply: string[]) => Promise<void>
}

export function PullModal({ open, preview, onClose, onApply }: Props) {
  const t = useT()
  const [acceptedDeletions, setAcceptedDeletions] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  if (!open || !preview || preview.kind !== 'preview') return null

  const items: PreviewItem[] = preview.items
  const added = items.filter((i) => i.status === 'added')
  const modified = items.filter((i) => i.status === 'modified')
  const deleted = items.filter((i) => i.status === 'deleted')
  const skipped = items.filter((i) => i.status === 'skipped-unreadable')

  const toggleDeletion = (path: string) => {
    setAcceptedDeletions((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleApply = async () => {
    setBusy(true)
    try {
      await onApply(Array.from(acceptedDeletions))
    } finally {
      setBusy(false)
    }
  }

  const handleOpenChange = (o: boolean) => {
    if (!o) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('pull.modal.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {added.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('pull.modal.added', { n: added.length })}
              </h3>
              <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 font-mono text-xs">
                {added.map((i) => (
                  <div key={i.repoPath} className="truncate" title={i.repoPath}>
                    {i.repoPath}
                  </div>
                ))}
              </div>
            </section>
          )}

          {modified.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('pull.modal.modified', { n: modified.length })}
              </h3>
              <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 font-mono text-xs">
                {modified.map((i) => (
                  <div key={i.repoPath} className="truncate" title={i.repoPath}>
                    {i.repoPath}
                  </div>
                ))}
              </div>
            </section>
          )}

          {deleted.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('pull.modal.deleted', { n: deleted.length })}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">{t('pull.modal.deletedHint')}</p>
              <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 space-y-1">
                {deleted.map((i) => (
                  <label key={i.repoPath} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptedDeletions.has(i.repoPath)}
                      onChange={() => toggleDeletion(i.repoPath)}
                      className="rounded"
                    />
                    <span className="truncate" title={i.repoPath}>
                      {i.repoPath}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {skipped.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500">
                {t('pull.modal.skipped', { n: skipped.length })}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">{t('pull.modal.skippedHint')}</p>
              <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border border-amber-500/40 p-2 font-mono text-xs">
                {skipped.map((i) => (
                  <div key={i.repoPath} className="truncate" title={i.repoPath}>
                    {i.repoPath}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleApply} disabled={busy}>
            {busy ? t('pull.modal.applying') : t('pull.modal.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
