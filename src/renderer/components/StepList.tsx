import React from 'react'
import type { LocalizedMessage, StepName, StepStatus } from '@shared/api'
import { useT, tMessage } from '../i18n'

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

type StepInfo = { status: StepStatus; message?: LocalizedMessage }

type Props = {
  steps: Record<StepName, StepInfo>
}

export function StepList({ steps }: Props) {
  const t = useT()

  const labels: Record<StepName, string> = {
    fetch: t('step.fetch'),
    install: t('step.install'),
    export: t('step.export'),
    pull: t('step.pull'),
    commit: t('step.commit'),
    push: t('step.push'),
  }

  const statusLabels: Record<StepStatus, string> = {
    idle: t('step.status.idle'),
    running: t('step.status.running'),
    done: t('step.status.done'),
    failed: t('step.status.failed'),
  }

  const order: StepName[] = ['fetch', 'install', 'export', 'pull', 'commit', 'push']
  return (
    <div className="space-y-2 px-4 py-3">
      {order.map((s) => {
        const info = steps[s]
        return (
          <div key={s} className="flex items-start gap-2">
            <span
              title={statusLabels[info.status]}
              className={`${statusColor(info.status)} ${info.status === 'running' ? 'animate-spin' : ''} w-5 text-center font-mono`}
            >
              {statusIcon(info.status)}
            </span>
            <div className="flex-1">
              <div className="text-sm">{labels[s]}</div>
              {info.message && info.status === 'failed' && (
                <div className="text-xs text-red-500">{tMessage(t, info.message)}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
