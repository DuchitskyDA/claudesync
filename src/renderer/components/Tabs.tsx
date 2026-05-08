import React from 'react'

type Props<T extends string> = {
  active: T
  onChange: (t: T) => void
  tabs: { id: T; label: string; disabled?: boolean; tooltip?: string }[]
}

export function Tabs<T extends string>({ active, onChange, tabs }: Props<T>) {
  return (
    <div className="flex border-b border-neutral-200 dark:border-neutral-700">
      {tabs.map((t) => (
        <button
          key={t.id}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
          title={t.tooltip}
          className={`px-4 py-2 text-sm transition ${
            active === t.id
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
          } disabled:cursor-not-allowed disabled:text-neutral-300 dark:disabled:text-neutral-600`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
