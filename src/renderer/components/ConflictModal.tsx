import React, { useEffect, useState } from 'react'
import type {
  ConflictFile,
  ConflictResolveChoice,
  ConflictFileContent,
  LocalizedMessage,
} from '@shared/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Button } from './ui/button'
import { useT, tMessage } from '../i18n'
import { ConflictFileList } from './ConflictFileList'
import { ThreeWayDiff } from './ThreeWayDiff'

type Props = {
  open: boolean
  onClose: () => void
  onContinued: () => void
}

type LocalStatus = ConflictFile['status']

type FileContents = {
  base: ConflictFileContent
  remote: ConflictFileContent
  mine: ConflictFileContent
}

export function ConflictModal({ open, onClose, onContinued }: Props) {
  const t = useT()
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [localStatus, setLocalStatus] = useState<Record<string, LocalStatus>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<FileContents | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [continuing, setContinuing] = useState(false)

  const refresh = async (statusOverride?: Record<string, LocalStatus>) => {
    const state = await window.api.conflictGetState()
    if (!state.inProgress) {
      onContinued()
      return
    }
    const statuses = statusOverride ?? localStatus
    const merged: ConflictFile[] = state.files.map((f) => ({
      ...f,
      status: statuses[f.path] ?? f.status,
    }))
    setFiles(merged)
    if (selectedPath == null && merged.length > 0) {
      setSelectedPath(merged[0]?.path ?? null)
    }
  }

  useEffect(() => {
    if (open) {
      void refresh()
    } else {
      setFiles([])
      setLocalStatus({})
      setSelectedPath(null)
      setContent(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!selectedPath) {
      setContent(null)
      return
    }
    let cancelled = false
    void (async () => {
      const [base, remote, mine] = await Promise.all([
        window.api.conflictGetFile(selectedPath, 'base'),
        window.api.conflictGetFile(selectedPath, 'remote'),
        window.api.conflictGetFile(selectedPath, 'mine'),
      ])
      if (!cancelled) setContent({ base, remote, mine })
    })()
    return () => {
      cancelled = true
    }
  }, [selectedPath])

  const handleResolve = async (path: string, choice: ConflictResolveChoice) => {
    setBusyPath(path)
    setError(null)
    try {
      const r = await window.api.conflictResolveFile(path, choice)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const newStatus: LocalStatus =
        choice === 'mine'
          ? 'resolved-mine'
          : choice === 'remote'
            ? 'resolved-remote'
            : 'resolved-manual'
      const next = { ...localStatus, [path]: newStatus }
      setLocalStatus(next)
      await refresh(next)
    } finally {
      setBusyPath(null)
    }
  }

  const handleOpenInEditor = async (path: string) => {
    await window.api.conflictOpenInEditor(path)
  }

  const handleContinue = async () => {
    setContinuing(true)
    setError(null)
    try {
      const r = await window.api.conflictContinue()
      if (!r.ok) {
        if (r.kind === 'conflict') {
          setLocalStatus({})
          await refresh({})
          if (r.error) setError(r.error)
          return
        }
        if (r.error) setError(r.error)
        return
      }
      onContinued()
    } finally {
      setContinuing(false)
    }
  }

  const handleAbort = async () => {
    if (!window.confirm(t('conflict.modal.abortConfirm'))) return
    await window.api.conflictAbort()
    onClose()
  }

  const allResolved = files.every((f) => f.status !== 'unresolved')
  const selectedFile = files.find((f) => f.path === selectedPath) ?? null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="flex h-[82vh] w-[min(1180px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-row items-start justify-between border-b px-5 py-3">
          <div className="min-w-0 flex-1 pr-4">
            <DialogTitle>{t('conflict.modal.title')}</DialogTitle>
            <DialogDescription className="mt-0.5">
              {t('conflict.modal.description')}
            </DialogDescription>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => void handleAbort()}>
              {t('conflict.modal.abort')}
            </Button>
            <Button onClick={() => void handleContinue()} disabled={!allResolved || continuing}>
              {t('conflict.modal.continue')}
            </Button>
          </div>
        </DialogHeader>

        {error && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-sm text-destructive">
            {tMessage(t, error)}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <ConflictFileList
            files={files}
            selectedPath={selectedPath}
            busyPath={busyPath}
            onSelect={setSelectedPath}
            onResolve={handleResolve}
            onOpenInEditor={handleOpenInEditor}
          />
          <div className="flex-1 overflow-hidden">
            {selectedFile && content ? (
              <ThreeWayDiff path={selectedFile.path} fileContent={content} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
