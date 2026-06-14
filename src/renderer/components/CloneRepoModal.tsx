import React, { useEffect, useState } from 'react'
import type { LocalizedMessage } from '@shared/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useT } from '../i18n'

type Props = {
  open: boolean
  repoUrl: string | null
  onClose: () => void
  /** Called after a successful clone or adopt — repoPath is now set in config. */
  onDone: () => void
}

export function CloneRepoModal({ open, repoUrl, onClose, onDone }: Props) {
  const t = useT()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<LocalizedMessage | null>(null)
  const [found, setFound] = useState<string[] | null>(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    setFound(null)
    setBusy(false)
    if (repoUrl) void window.api.suggestRepoPath(repoUrl).then(setPath)
  }, [open, repoUrl])

  const browse = async () => {
    const p = await window.api.pickRepoPath()
    if (p) setPath(p)
  }

  const findExisting = async () => {
    if (!repoUrl) return
    setFound(await window.api.findExistingClones(repoUrl))
  }

  const clone = async () => {
    if (!repoUrl) return
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.cloneRepo(repoUrl, path)
      if (r.ok) {
        onDone()
        onClose()
      } else {
        setErr(r.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const adopt = async (p: string) => {
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.adoptRepoPath(p)
      if (r.ok) {
        onDone()
        onClose()
      } else {
        setErr(r.error ?? { key: 'clone.error.failed' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('clone.modal.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('clone.modal.subtitle')}</p>

          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={browse} disabled={busy}>
              {t('clone.modal.browse')}
            </Button>
          </div>

          <Button variant="ghost" size="sm" onClick={findExisting} disabled={busy} className="self-start">
            {t('clone.modal.findExisting')}
          </Button>

          {found && (found.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('clone.modal.foundNone')}</p>
          ) : (
            <ul className="space-y-1">
              {found.map((p) => (
                <li key={p} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-mono">{p}</span>
                  <Button size="sm" variant="outline" onClick={() => void adopt(p)} disabled={busy}>
                    {t('clone.modal.adopt')}
                  </Button>
                </li>
              ))}
            </ul>
          ))}

          {err && <p className="text-xs text-red-500">{err.fallback ?? t(err.key)}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('clone.modal.skip')}
          </Button>
          <Button onClick={clone} disabled={busy || !path.trim() || !repoUrl}>
            {busy ? t('clone.modal.cloning') : t('clone.modal.clone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
