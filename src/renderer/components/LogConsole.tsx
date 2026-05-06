import React, { useEffect, useRef } from 'react'
import type { LogLine } from '@shared/api'

type Props = {
  lines: LogLine[]
  onClear: () => void
}

const colorFor = (lvl: LogLine['level']): string =>
  lvl === 'error'
    ? 'text-red-500'
    : lvl === 'success'
      ? 'text-emerald-500'
      : 'text-neutral-700 dark:text-neutral-300'

export function LogConsole({ lines, onClear }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-700">
        <span>Log</span>
        <button
          onClick={onClear}
          className="rounded px-2 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          Clear
        </button>
      </div>
      <div
        ref={ref}
        className="flex-1 overflow-auto bg-neutral-100 p-2 font-mono text-xs leading-relaxed dark:bg-neutral-900"
      >
        {lines.length === 0 ? (
          <div className="text-neutral-400">No output yet.</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={colorFor(l.level)}>
              <span className="text-neutral-400">[{l.time}]</span> {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
