import React, { useState } from 'react'
import type { PluginEnvRequirement } from '@shared/api'
import { useT } from '../i18n'

type Props = {
  pluginName: string
  requirement: PluginEnvRequirement
  onSkip: () => void
  onSave: (value: string) => void
}

const inputCls =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100'

const ghostBtnCls =
  'rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'

export function EnvPromptModal({ pluginName, requirement, onSkip, onSave }: Props) {
  const t = useT()
  const [value, setValue] = useState('')
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[88vh] w-[480px] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <h2 className="font-display text-base font-semibold tracking-tight">
            {t('envPrompt.title', { pluginName })}
          </h2>
          <button
            onClick={onSkip}
            aria-label="Close"
            className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-300">
            {requirement.instructions}
          </p>
          {requirement.docsUrl && (
            <a
              href={requirement.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mb-4 inline-block text-sm text-blue-500 hover:underline"
            >
              {t('envPrompt.openDocs', { url: requirement.docsUrl })}
            </a>
          )}
          <label className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {requirement.label}
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={requirement.placeholder}
            className={`font-mono ${inputCls}`}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <button onClick={onSkip} className={ghostBtnCls}>
            {t('envPrompt.skip')}
          </button>
          <button
            onClick={() => onSave(value)}
            disabled={value.trim() === ''}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none dark:disabled:bg-neutral-700"
          >
            {t('envPrompt.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
