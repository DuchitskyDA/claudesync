import React from 'react'
import { lineDiff, isProbablyBinary } from '../lib/diff'
import { useT } from '../i18n'
import { cn } from '@/lib/utils'

/** Max combined length (UTF-16 code units, a cheap proxy for size) of both
 *  sides before we skip the O(n·m) diff so a huge file can't freeze the
 *  renderer. Mirrors ThreeWayDiff's cap. */
const MAX_DIFF_CHARS = 500 * 1024

type Props = {
  /** Local ("mine") version — the diff's new side (green `+`). */
  mine: string
  /** Remote ("theirs") version — the diff's old side (red `-`). */
  theirs: string
}

/**
 * Inline unified diff between the remote and local versions of a conflicting
 * file. Old side = remote (theirs), new side = local (mine), so `-` lines are
 * what the remote has and `+` lines are what the local copy changes.
 */
export function DiffPreview({ mine, theirs }: Props) {
  const t = useT()

  if (isProbablyBinary(mine) || isProbablyBinary(theirs)) {
    return <Notice>{t('conflict.diff.binary')}</Notice>
  }

  const totalChars = mine.length + theirs.length
  if (totalChars > MAX_DIFF_CHARS) {
    return <Notice>{t('conflict.diff.tooLarge', { size: Math.round(totalChars / 1024) })}</Notice>
  }

  const rows = lineDiff(theirs, mine)
  if (rows.length === 0) {
    return <Notice>{t('conflict.diff.empty')}</Notice>
  }
  if (rows.every((r) => r.type === 'context')) {
    return <Notice>{t('conflict.diff.identical')}</Notice>
  }

  return (
    <div className="max-h-60 overflow-auto rounded border bg-muted/20 font-mono text-xs">
      <pre className="m-0 p-0">
        {rows.map((row, i) => (
          <span
            key={i}
            className={cn(
              'block px-3 py-0.5',
              row.type === 'add' && 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
              row.type === 'del' && 'bg-red-500/15 text-red-800 dark:text-red-300',
              row.type === 'context' && 'text-muted-foreground',
            )}
          >
            <span className="select-none opacity-60">
              {row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  '}
            </span>
            {row.text || ' '}
          </span>
        ))}
      </pre>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-16 items-center justify-center rounded border bg-muted/20 text-xs text-muted-foreground">
      {children}
    </div>
  )
}
