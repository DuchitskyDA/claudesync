import React, { useState } from 'react'
import type { GitHubAuthState } from '@shared/api'
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
        <div className="text-sm">
          ✓ {t('init.signIn.signedIn', { login: authState.login ?? '' })}
        </div>
        <button
          onClick={onContinue}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          {t('init.nav.next')}
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t('init.signIn.description')}
      </p>
      <button
        onClick={() => setModalOpen(true)}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        {t('init.signIn.title')}
      </button>
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
