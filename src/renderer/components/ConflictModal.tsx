import React, { useEffect, useState } from 'react'
import type {
  ConflictFile,
  ConflictResolveChoice,
  ConflictFileContent,
  LocalizedMessage,
} from '@shared/api'
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
    // refresh closes over localStatus; intentionally omitted from deps
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

  if (!open) return null

  const allResolved = files.every((f) => f.status !== 'unresolved')
  const selectedFile = files.find((f) => f.path === selectedPath) ?? null

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
      <div className="flex h-[82vh] w-[min(1180px,94vw)] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <div className="min-w-0 pr-4">
            <h2 className="font-display text-base font-semibold tracking-tight">
              {t('conflict.modal.title')}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {t('conflict.modal.description')}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              onClick={() => void handleAbort()}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {t('conflict.modal.abort')}
            </button>
            <button
              onClick={() => void handleContinue()}
              disabled={!allResolved || continuing}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none dark:disabled:bg-neutral-700"
            >
              {t('conflict.modal.continue')}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {tMessage(t, error)}
          </div>
        )}

        {/* Body */}
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
              <div className="flex h-full items-center justify-center text-sm text-neutral-500" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
