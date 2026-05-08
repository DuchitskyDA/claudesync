import React, { useState } from 'react'
import type { PluginEnvRequirement } from '@shared/api'

type Props = {
  pluginName: string
  requirement: PluginEnvRequirement
  onSkip: () => void
  onSave: (value: string) => void
}

export function EnvPromptModal({ pluginName, requirement, onSkip, onSave }: Props) {
  const [value, setValue] = useState('')
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-2 text-base font-semibold">{pluginName} — API Key required</h2>
        <p className="mb-3 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-300">
          {requirement.instructions}
        </p>
        {requirement.docsUrl && (
          <a
            href={requirement.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mb-3 inline-block text-sm text-blue-500 hover:underline"
          >
            Open {requirement.docsUrl}
          </a>
        )}
        <label className="mb-1 block text-xs text-neutral-500">{requirement.label}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={requirement.placeholder}
          className="mb-4 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onSkip}
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Skip plugin
          </button>
          <button
            onClick={() => onSave(value)}
            disabled={value.trim() === ''}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
          >
            Save &amp; enable
          </button>
        </div>
      </div>
    </div>
  )
}
