import React, { useEffect, useState } from 'react'
import type { CursorProject } from '@shared/api'
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
  onClose: () => void
  onConfirm: (opts: { installClaude: boolean; cursorProjectNames: string[] }) => Promise<void>
}

type State = {
  claudeAvailable: boolean
  cursorProjects: CursorProject[]
}

export function InstallModal({ open, onClose, onConfirm }: Props) {
  const t = useT()
  const [state, setState] = useState<State | null>(null)
  const [claude, setClaude] = useState(false)
  const [cursorSelected, setCursorSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setBusy(false)
    void window.api.getConfig().then((cfg) => {
      const claudeAvailable = !!cfg.claude.path && cfg.claude.enabled
      const cursorProjects = cfg.cursor.enabled ? cfg.cursor.projects : []
      setState({ claudeAvailable, cursorProjects })
      setClaude(claudeAvailable)
      setCursorSelected(new Set(cursorProjects.map((p) => p.name)))
    })
  }, [open])

  const toggleCursor = (name: string) => {
    setCursorSelected((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const canConfirm = (claude || cursorSelected.size > 0) && !busy

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onConfirm({
        installClaude: claude,
        cursorProjectNames: Array.from(cursorSelected),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('install.modal.title')}</DialogTitle>
        </DialogHeader>

        {!state ? (
          <div className="text-sm text-muted-foreground">{t('install.modal.loading')}</div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('install.modal.description')}</p>

            {state.claudeAvailable ? (
              <label className="flex items-start gap-3 rounded-md border p-3">
                <input
                  type="checkbox"
                  checked={claude}
                  onChange={(e) => setClaude(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t('install.modal.claude.label')}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('install.modal.claude.hint')}
                  </div>
                </div>
              </label>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {t('install.modal.claude.disabled')}
              </div>
            )}

            {state.cursorProjects.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('install.modal.cursor.heading')}
                </div>
                {state.cursorProjects.map((p) => (
                  <label
                    key={p.name}
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    <input
                      type="checkbox"
                      checked={cursorSelected.has(p.name)}
                      onChange={() => toggleCursor(p.name)}
                      className="mt-0.5 accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="font-mono text-xs text-muted-foreground truncate">{p.path}</div>
                    </div>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">{t('install.modal.cursor.overwriteHint')}</p>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {t('install.modal.cursor.disabled')}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {busy ? t('install.modal.installing') : t('install.modal.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
