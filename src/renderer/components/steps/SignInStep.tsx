import React, { useState } from 'react'
import type { GitHubAuthState } from '@shared/api'
import { Check } from 'lucide-react'
import { Button } from '../ui/button'
import { useT } from '../../i18n'
import { DeviceFlowModal } from '../DeviceFlowModal'

type Props = {
  authState: GitHubAuthState | null
  onSignedIn: () => void
  onContinue: () => void
}

export function SignInStep({ authState, onSignedIn, onContinue }: Props) {
  const t = useT()
  const [modalOpen, setModalOpen] = useState(false)

  if (authState?.authenticated) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-emerald-500" />
          {t('init.signIn.signedIn', { login: authState.login ?? '' })}
        </div>
        <Button onClick={onContinue}>{t('init.nav.next')}</Button>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('init.signIn.description')}</p>
      <Button onClick={() => setModalOpen(true)}>{t('init.signIn.title')}</Button>
      <DeviceFlowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false)
          onSignedIn()
        }}
      />
    </div>
  )
}
