import React, { useState, useCallback } from 'react'
import type { GitHubAuthState, RunResult } from '@shared/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { useT } from '../i18n'
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
  const t = useT()
  const [phase, setPhase] = useState<Phase>(authState?.authenticated ? 'settings' : 'sign-in')
  const [settings, setSettings] = useState<RepoSettings | null>(null)
  const [finalRepoUrl, setFinalRepoUrl] = useState<string | null>(null)

  const startInit = useCallback(async (): Promise<RunResult> => {
    if (!settings) return { ok: false, exitCode: -1, error: { key: 'init.error.noSettings', fallback: 'No settings' } }
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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[640px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('init.title')}</DialogTitle>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  )
}
