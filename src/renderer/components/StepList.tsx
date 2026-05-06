import React from 'react'
import type { StepName, StepStatus } from '@shared/api'

const labels: Record<StepName, string> = {
  fetch: 'Получаю репозиторий',
  install: 'Устанавливаю правила',
}

const statusIcon = (s: StepStatus): string =>
  s === 'idle' ? '○' : s === 'running' ? '⟳' : s === 'done' ? '✓' : '✗'

const statusColor = (s: StepStatus): string =>
  s === 'idle'
    ? 'text-neutral-400'
    : s === 'running'
      ? 'text-blue-500'
      : s === 'done'
        ? 'text-emerald-500'
        : 'text-red-500'

type StepInfo = { status: StepStatus; message?: string }

type Props = {
  steps: Record<StepName, StepInfo>
}

export function StepList({ steps }: Props) {
  const order: StepName[] = ['fetch', 'install']
  return (
    <div className="space-y-2 px-4 py-3">
      {order.map((s) => {
        const info = steps[s]
        return (
          <div key={s} className="flex items-start gap-2">
            <span
              className={`${statusColor(info.status)} ${info.status === 'running' ? 'animate-spin' : ''} w-5 text-center font-mono`}
            >
              {statusIcon(info.status)}
            </span>
            <div className="flex-1">
              <div className="text-sm">{labels[s]}</div>
              {info.message && info.status === 'failed' && (
                <div className="text-xs text-red-500">{info.message}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
