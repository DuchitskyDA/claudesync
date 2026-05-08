import React, { useEffect, useRef } from 'react'
import type { LogLine } from '@shared/api'
import { Button } from './ui/button'
import { useT } from '../i18n'
import { cn } from '@/lib/utils'

type Props = {
  lines: LogLine[]
  onClear: () => void
}

const colorFor = (lvl: LogLine['level']): string =>
  lvl === 'error'
    ? 'text-red-500 dark:text-red-400'
    : lvl === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-foreground'

export function LogConsole({ lines, onClear }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span>Log</span>
        <Button onClick={onClear} variant="ghost" size="sm" className="h-6 px-2 text-xs">
          {t('log.clear')}
        </Button>
      </div>
      <div
        ref={ref}
        className="flex-1 overflow-auto bg-muted/40 p-2 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-muted-foreground">{t('log.empty')}</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={cn(colorFor(l.level))}>
              <span className="text-muted-foreground">[{l.time}]</span> {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
