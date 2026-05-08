import React, { useEffect, useState } from 'react'
import type { InitStepEvent, RunResult } from '@shared/api'

type Props = {
  onClose: () => void
  startInit: () => Promise<RunResult>
  finalRepoUrl: string | null
}

const stepOrder = ['create-repo', 'clone', 'generate', 'commit', 'push'] as const
const labels: Record<(typeof stepOrder)[number], string> = {
  'create-repo': 'Создаю репозиторий на GitHub',
  clone: 'Клонирую',
  generate: 'Генерирую структуру',
  commit: 'Initial commit',
  push: 'Пушу',
}

type StepInfo = { status: 'idle' | 'running' | 'done' | 'failed'; message?: string }

export function ProgressStep({ onClose, startInit, finalRepoUrl }: Props) {
  const [stepStates, setStepStates] = useState<Record<string, StepInfo>>({})
  const [result, setResult] = useState<RunResult | null>(null)

  useEffect(() => {
    const unsub = window.api.onInitStep((e: InitStepEvent) => {
      setStepStates((prev) => ({ ...prev, [e.step]: { status: e.status, message: e.message } }))
    })
    void startInit().then(setResult)
    return () => unsub()
  }, [startInit])

  return (
    <div className="space-y-4">
      <ul className="space-y-1 font-mono text-sm">
        {stepOrder.map((step) => {
          const s = stepStates[step]
          const icon = !s ? '○' : s.status === 'running' ? '⟳' : s.status === 'done' ? '✓' : '✗'
          const color = !s
            ? 'text-neutral-400'
            : s.status === 'running'
              ? 'text-blue-500'
              : s.status === 'done'
                ? 'text-emerald-500'
                : 'text-red-500'
          return (
            <li key={step} className="flex gap-2">
              <span className={`w-5 ${color}`}>{icon}</span>
              <span>{labels[step]}</span>
              {s?.message && <span className="text-xs text-red-500">— {s.message}</span>}
            </li>
          )
        })}
      </ul>

      {result?.ok && finalRepoUrl && (
        <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          ✓ Done! Repo:{' '}
          <a href={finalRepoUrl} target="_blank" rel="noreferrer" className="underline">
            {finalRepoUrl}
          </a>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          ✗ {result.error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onClose}
          disabled={!result}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
        >
          Close
        </button>
      </div>
    </div>
  )
}
