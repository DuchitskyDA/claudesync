import React from 'react'
import type { PresetEntry } from '@shared/api'

type Props = {
  preset: PresetEntry
  onApply: () => void
}

export function PresetCard({ preset, onApply }: Props) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="font-medium">{preset.name}</div>
      <div className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">{preset.description}</div>
      <div className="mb-3 text-xs text-neutral-500">{preset.pluginIds.length} plugins</div>
      <button
        onClick={onApply}
        className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
      >
        Apply preset
      </button>
    </div>
  )
}
