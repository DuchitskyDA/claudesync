import React, { useRef } from 'react'
import type { ConflictFileContent } from '@shared/api'
import { useT } from '../i18n'
import { cn } from '@/lib/utils'

const MAX_PREVIEW_BYTES = 500 * 1024

type Props = {
  path: string
  fileContent: {
    base: ConflictFileContent
    remote: ConflictFileContent
    mine: ConflictFileContent
  }
}

function colorRow(line: string, baseLines: Set<string>, otherSide: Set<string>): string {
  if (baseLines.has(line)) return ''
  if (otherSide.has(line)) return 'bg-yellow-100/60 dark:bg-yellow-500/15'
  return 'bg-amber-200/60 dark:bg-amber-500/25'
}

export function ThreeWayDiff({ path, fileContent }: Props) {
  const t = useT()
  const { base, remote, mine } = fileContent

  const colsRef = useRef<(HTMLDivElement | null)[]>([null, null, null])
  const setRef = (i: number) => (el: HTMLDivElement | null) => {
    colsRef.current[i] = el
  }
  const onScroll = (sourceIdx: number) => (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    colsRef.current.forEach((el, i) => {
      if (i !== sourceIdx && el) el.scrollTop = top
    })
  }

  if (base.binary || remote.binary || mine.binary) {
    return (
      <Wrapper path={path}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('conflict.diff.binary')}
        </div>
      </Wrapper>
    )
  }

  const baseText = base.text ?? ''
  const remoteText = remote.text ?? ''
  const mineText = mine.text ?? ''
  const totalBytes = baseText.length + remoteText.length + mineText.length

  if (totalBytes > MAX_PREVIEW_BYTES) {
    return (
      <Wrapper path={path}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('conflict.diff.tooLarge', { size: Math.round(totalBytes / 1024) })}
        </div>
      </Wrapper>
    )
  }

  const baseLines = baseText.split('\n')
  const remoteLines = remoteText.split('\n')
  const mineLines = mineText.split('\n')
  const baseSet = new Set(baseLines)
  const remoteSet = new Set(remoteLines)
  const mineSet = new Set(mineLines)

  const renderColumn = (
    label: string,
    lines: string[],
    otherSide: Set<string>,
    idx: number,
  ) => (
    <div className="flex min-w-0 flex-1 flex-col border-r last:border-r-0">
      <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold">{label}</div>
      <div
        ref={setRef(idx)}
        onScroll={onScroll(idx)}
        className="flex-1 overflow-auto font-mono text-xs"
      >
        <pre className="m-0 p-0">
          {lines.length === 0 || (lines.length === 1 && lines[0] === '') ? (
            <span className="block px-3 py-0.5 text-muted-foreground">
              {t('conflict.diff.empty')}
            </span>
          ) : (
            lines.map((line, i) => (
              <span key={i} className={cn('block px-3 py-0.5', colorRow(line, baseSet, otherSide))}>
                {line || ' '}
              </span>
            ))
          )}
        </pre>
      </div>
    </div>
  )

  return (
    <Wrapper path={path}>
      <div className="flex flex-1 overflow-hidden">
        {renderColumn(t('conflict.diff.base'), baseLines, new Set(), 0)}
        {renderColumn(t('conflict.diff.remote'), remoteLines, mineSet, 1)}
        {renderColumn(t('conflict.diff.mine'), mineLines, remoteSet, 2)}
      </div>
    </Wrapper>
  )
}

function Wrapper({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-1.5 font-mono text-xs text-muted-foreground">{path}</div>
      {children}
    </div>
  )
}
