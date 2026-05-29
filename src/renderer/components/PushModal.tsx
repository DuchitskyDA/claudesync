import React, { useEffect, useState } from 'react'
import type { RepoStatus } from '@shared/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { useT } from '../i18n'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (commitMessage: string, includeSecrets: boolean, approvedDeletions: string[]) => Promise<void>
}

export function PushModal({ open, onClose, onConfirm }: Props) {
  const t = useT()
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [message, setMessage] = useState('')
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMessage(''); setError(null); setBusy(false); setApproved(new Set())
    void window.api.previewPushStatus().then(setStatus)
    void window.api.getConfig().then((cfg) => setIncludeSecrets(cfg.includeSecretsInPush))
  }, [open])

  const floorBlocked = !!status && status.floorBlocked.length > 0

  const handleConfirm = async () => {
    setBusy(true); setError(null)
    try {
      const cfg = await window.api.getConfig()
      await window.api.setConfig({ ...cfg, includeSecretsInPush: includeSecrets })
      await onConfirm(message.trim(), includeSecrets, [...approved])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (p: string) =>
    setApproved((cur) => {
      const next = new Set(cur)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })

  const FileList = ({ items }: { items: string[] }) => (
    <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 font-mono text-xs">
      {items.map((f) => <div key={f} className="truncate" title={f}>{f}</div>)}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader><DialogTitle>{t('push.modal.title')}</DialogTitle></DialogHeader>

        {!status ? (
          <div className="text-sm text-muted-foreground">{t('push.modal.checkingStatus')}</div>
        ) : floorBlocked ? (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <div className="font-semibold text-destructive">{t('push.modal.floorBlocked.title')}</div>
            <div className="text-muted-foreground">{t('push.modal.floorBlocked.body')}</div>
            <ul className="font-mono text-xs">
              {status.floorBlocked.map((v) => (
                <li key={v.source}>{t('push.modal.floorBlocked.row', { source: v.source, deleting: v.deleting, headCount: v.headCount })}</li>
              ))}
            </ul>
          </div>
        ) : status.clean ? (
          <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('push.info.nothingToPush')}
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            {status.added.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('push.modal.section.added', { count: status.added.length })}</h3>
                <FileList items={status.added} />
              </div>
            )}
            {status.modified.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('push.modal.section.modified', { count: status.modified.length })}</h3>
                <FileList items={status.modified} />
              </div>
            )}
            {status.deletions.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">{t('push.modal.section.deletions', { count: status.deletions.length })}</h3>
                <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 font-mono text-xs">
                  {status.deletions.map((f) => (
                    <label key={f} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={approved.has(f)} onChange={() => toggle(f)} className="accent-primary" />
                      <span className="truncate" title={f}>{f}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {status.unreadable.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">{t('push.modal.section.unreadable', { count: status.unreadable.length })}</h3>
                <FileList items={status.unreadable} />
                <p className="mt-1 text-xs text-muted-foreground">{t('push.modal.unreadable.hint')}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="commit-message">{t('push.modal.commitMessage.label')}</Label>
              <Textarea id="commit-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={t('push.modal.commitMessage.placeholder')} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="include-secrets" className="cursor-pointer">{t('push.modal.includeSecrets.label')}</Label>
                <Switch id="include-secrets" checked={includeSecrets} onCheckedChange={setIncludeSecrets} />
              </div>
              {includeSecrets && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  {t('push.modal.includeSecrets.warning')}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          {!!status && !status.clean && !floorBlocked && (
            <Button onClick={handleConfirm} disabled={busy || message.trim() === ''}>
              {busy ? t('push.modal.pushing') : t('push.modal.push')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
