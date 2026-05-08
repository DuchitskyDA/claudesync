import React, { useState, useCallback } from 'react'
import type { GitHubAuthState, RunResult } from '@shared/api'
import { SignInStep } from './steps/SignInStep'
import { RepoSettingsStep } from './steps/RepoSettingsStep'
import type { RepoSettings } from './steps/RepoSettingsStep'
import { PreviewStep } from './steps/PreviewStep'
import { ProgressStep } from './steps/ProgressStep'

type Props = {
  open: boolean
  authState: GitHubAuthState | null
  onClose: () => void
  onAuthChanged: () => void
  onCompleted: () => void
}

type Phase = 'sign-in' | 'settings' | 'preview' | 'progress'

export function InitWizard({ open, authState, onClose, onAuthChanged, onCompleted }: Props) {
  const [phase, setPhase] = useState<Phase>(authState?.authenticated ? 'settings' : 'sign-in')
  const [settings, setSettings] = useState<RepoSettings | null>(null)
  const [finalRepoUrl, setFinalRepoUrl] = useState<string | null>(null)

  const startInit = useCallback(async (): Promise<RunResult> => {
    if (!settings) return { ok: false, exitCode: -1, error: 'No settings' }
    const r = await window.api.initRepo({
      owner: settings.owner,
      name: settings.name,
      isPrivate: settings.isPrivate,
      description: settings.description || undefined,
    })
    if (r.ok) {
      const cfg = await window.api.getConfig()
      if (cfg.repoUrl) setFinalRepoUrl(cfg.repoUrl.replace(/\.git$/, ''))
      onCompleted()
    }
    return r
  }, [settings, onCompleted])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
      <div className="w-[640px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Initialize new repo</h2>
          <button
            onClick={onClose}
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            ×
          </button>
        </div>

        {phase === 'sign-in' && (
          <SignInStep
            authState={authState}
            onSignedIn={() => {
              onAuthChanged()
              setPhase('settings')
            }}
            onContinue={() => setPhase('settings')}
          />
        )}
        {phase === 'settings' && (
          <RepoSettingsStep
            initial={settings ?? undefined}
            onBack={() => setPhase('sign-in')}
            onContinue={(s) => {
              setSettings(s)
              setPhase('preview')
            }}
          />
        )}
        {phase === 'preview' && (
          <PreviewStep onBack={() => setPhase('settings')} onConfirm={() => setPhase('progress')} />
        )}
        {phase === 'progress' && (
          <ProgressStep onClose={onClose} startInit={startInit} finalRepoUrl={finalRepoUrl} />
        )}
      </div>
    </div>
  )
}
