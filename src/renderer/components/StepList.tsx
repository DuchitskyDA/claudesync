import React from 'react'
import type { LocalizedMessage, StepName, StepStatus } from '@shared/api'
import { Circle, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useT, tMessage } from '../i18n'
import { cn } from '@/lib/utils'

type StepInfo = { status: StepStatus; message?: LocalizedMessage }

type Props = {
  steps: Record<StepName, StepInfo>
}

function StatusIcon({ status }: { status: StepStatus }) {
  const className = cn(
    'h-4 w-4 shrink-0',
    status === 'idle' && 'text-muted-foreground',
    status === 'running' && 'text-primary animate-spin',
    status === 'done' && 'text-emerald-500',
    status === 'failed' && 'text-destructive',
  )
  if (status === 'idle') return <Circle className={className} />
  if (status === 'running') return <Loader2 className={className} />
  if (status === 'done') return <CheckCircle2 className={className} />
  return <XCircle className={className} />
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
            <span title={statusLabels[info.status]} className="pt-0.5">
              <StatusIcon status={info.status} />
            </span>
            <div className="flex-1">
              <div className="text-sm">{labels[s]}</div>
              {info.message && info.status === 'failed' && (
                <div className="text-xs text-destructive">{tMessage(t, info.message)}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
