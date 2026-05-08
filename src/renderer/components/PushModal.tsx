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
  onConfirm: (commitMessage: string, includeSecrets: boolean) => Promise<void>
}

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
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('push.modal.title')}</DialogTitle>
        </DialogHeader>

        {!status ? (
          <div className="text-sm text-muted-foreground">{t('push.modal.checkingStatus')}</div>
        ) : status.clean ? (
          <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('push.info.nothingToPush')}
          </div>
        ) : (
          // `min-w-0` lets this grid item shrink below its min-content; without
          // it, a long unbreakable file path in the changed-files list pushes
          // the body wider than the dialog's max-width, making the textarea
          // and footer buttons overflow the modal box visually.
          <div className="min-w-0 space-y-4">
            <div className="min-w-0">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('push.modal.changedFiles', { count: status.changedFiles.length })}
              </h3>
              <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border p-2 font-mono text-xs">
                {status.changedFiles.map((f) => (
                  <div key={f} className="truncate" title={f}>{f}</div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="commit-message">{t('push.modal.commitMessage.label')}</Label>
              <Textarea
                id="commit-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder={t('push.modal.commitMessage.placeholder')}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="include-secrets" className="cursor-pointer">
                  {t('push.modal.includeSecrets.label')}
                </Label>
                <Switch
                  id="include-secrets"
                  checked={includeSecrets}
                  onCheckedChange={setIncludeSecrets}
                />
              </div>
              {includeSecrets && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  {t('push.modal.includeSecrets.warning')}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          {!status?.clean && (
            <Button onClick={handleConfirm} disabled={busy || message.trim() === ''}>
              {busy ? t('push.modal.pushing') : t('push.modal.push')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
