import React, { useEffect, useState } from 'react'
import type { ResolverState, ResolverFile } from '@shared/sync-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Button } from './ui/button'
import { useT } from '../i18n'

type Props = {
  open: boolean
  onClose: () => void
  onContinued: () => void
}

/**
 * Safely decode a Buffer-like value that came over IPC.
 * IPC serialises Node Buffer as { type: 'Buffer', data: number[] } or as a
 * plain Uint8Array. We must not assume Buffer is available in the renderer.
 */
function asString(b: unknown): string {
  if (!b) return ''
  if (typeof b === 'string') return b
  const obj = b as Record<string, unknown>
  // { type: 'Buffer', data: [...] }
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(obj.data as number[]))
    } catch {
      return ''
    }
  }
  // Nested: { data: { type: 'Buffer', data: [...] } }
  if (obj.data && typeof obj.data === 'object') {
    return asString(obj.data)
  }
  // Uint8Array / ArrayBuffer
  if (ArrayBuffer.isView(b)) {
    try {
      return new TextDecoder('utf-8').decode(b as BufferSource)
    } catch {
      return ''
    }
  }
  try { return String(b) } catch { return '' }
}

export function ConflictModal({ open, onClose, onContinued }: Props) {
  const t = useT()
  const [state, setState] = useState<ResolverState | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState(t('conflict.commitDefault'))

  // choices: path -> 'mine' | 'theirs'
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>({})

  const loadState = async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await window.api.resolverGetState()
      setState(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      void loadState()
    } else {
      setState(null)
      setChoices({})
      setError(null)
      setCommitMessage(t('conflict.commitDefault'))
    }
  }, [open])

  const handleDiscard = async () => {
    if (!window.confirm(t('conflict.discard'))) return
    await window.api.resolverDiscard()
    // Resolver state has been cleared on disk — signal "no longer in progress"
    // so the recovery banner disappears.
    onContinued()
  }

  const handleApply = async () => {
    if (!state) return
    setApplying(true)
    setError(null)
    try {
      // Build resolutions: apply per-file choices back into the state
      const resolutions: ResolverState = {
        ...state,
        files: state.files.map((f) => ({
          ...f,
          choice: (choices[f.repoPath] ?? null) as ResolverFile['choice'],
        })),
      }
      const r = await window.api.resolverExecute(commitMessage, resolutions)
      if (r.kind === 'ok') {
        onContinued()
      } else {
        setError(r.message)
      }
    } finally {
      setApplying(false)
    }
  }

  const allChosen =
    state !== null &&
    state.files.length > 0 &&
    state.files.every((f) => choices[f.repoPath] != null)

  const files = state?.files ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="flex max-h-[85vh] w-[min(860px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-row items-start justify-between border-b py-3 pl-5 pr-12">
          <div className="min-w-0 flex-1 pr-4">
            <DialogTitle>{t('conflict.title')}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {loading
                ? t('sync.status.checking')
                : t('conflict.filesToResolve', { count: files.length })}
            </DialogDescription>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleDiscard()}>
              {t('conflict.discard')}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleApply()}
              disabled={!allChosen || applying}
            >
              {applying ? '…' : t('conflict.apply')}
            </Button>
          </div>
        </DialogHeader>

        {error && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Commit message */}
        <div className="border-b px-5 py-2">
          <input
            className="w-full rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder={t('conflict.commitDefault')}
          />
        </div>

        {/* File list */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {t('sync.status.checking')}
            </div>
          )}
          {!loading && files.length === 0 && (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {t('conflict.noFiles')}
            </div>
          )}
          {!loading &&
            files.map((f) => {
              const mine = asString(f.mine)
              const theirs = asString(f.theirs)
              const choice = choices[f.repoPath]
              return (
                <div key={f.repoPath} className="border-b px-5 py-3">
                  <div className="mb-2 font-mono text-sm font-medium">{f.repoPath}</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={choice === 'mine' ? 'default' : 'outline'}
                      onClick={() => setChoices((c) => ({ ...c, [f.repoPath]: 'mine' }))}
                    >
                      {t('conflict.keepMine')}
                    </Button>
                    <Button
                      size="sm"
                      variant={choice === 'theirs' ? 'default' : 'outline'}
                      onClick={() => setChoices((c) => ({ ...c, [f.repoPath]: 'theirs' }))}
                    >
                      {t('conflict.takeTheirs')}
                    </Button>
                  </div>
                  {choice && (
                    <div className="mt-2 max-h-40 overflow-auto rounded border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
                      {(choice === 'mine' ? mine : theirs) || '(empty)'}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
