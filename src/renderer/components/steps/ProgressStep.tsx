import React, { useEffect, useState } from 'react'
import type { InitStepEvent, LocalizedMessage, RunResult } from '@shared/api'
import { Circle, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useT, tMessage } from '../../i18n'
import { cn } from '@/lib/utils'

type Props = {
  onClose: () => void
  startInit: () => Promise<RunResult>
  finalRepoUrl: string | null
}

const stepOrder = ['create-repo', 'clone', 'generate', 'commit', 'push'] as const

type StepInfo = { status: 'idle' | 'running' | 'done' | 'failed'; message?: LocalizedMessage }

function StepIcon({ status }: { status: StepInfo['status'] | undefined }) {
  const cls = cn(
    'h-4 w-4 shrink-0',
    !status && 'text-muted-foreground',
    status === 'running' && 'text-primary animate-spin',
    status === 'done' && 'text-emerald-500',
    status === 'failed' && 'text-destructive',
  )
  if (!status || status === 'idle') return <Circle className={cls} />
  if (status === 'running') return <Loader2 className={cls} />
  if (status === 'done') return <CheckCircle2 className={cls} />
  return <XCircle className={cls} />
}

export function ProgressStep({ onClose, startInit, finalRepoUrl }: Props) {
  const t = useT()
  const labels: Record<(typeof stepOrder)[number], string> = {
    'create-repo': t('init.step.createRepo'),
    clone: t('init.step.clone'),
    generate: t('init.step.generate'),
    commit: t('init.step.commit'),
    push: t('init.step.push'),
  }
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
      <ul className="space-y-2 text-sm">
        {stepOrder.map((step) => {
          const s = stepStates[step]
          return (
            <li key={step} className="flex items-center gap-2">
              <StepIcon status={s?.status} />
              <span>{labels[step]}</span>
              {s?.message && (
                <span className="text-xs text-destructive">— {tMessage(t, s.message)}</span>
              )}
            </li>
          )
        })}
      </ul>

      {result?.ok && finalRepoUrl && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          ✓ {t('init.progress.success')} Repo:{' '}
          <a href={finalRepoUrl} target="_blank" rel="noreferrer" className="underline">
            {finalRepoUrl}
          </a>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          ✗ {tMessage(t, result.error)}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onClose} disabled={!result}>{t('init.progress.close')}</Button>
      </div>
    </div>
  )
}
