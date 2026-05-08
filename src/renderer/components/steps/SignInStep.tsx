import React, { useState } from 'react'
import type { GitHubAuthState } from '@shared/api'
import { DeviceFlowModal } from '../DeviceFlowModal'

type Props = {
  authState: GitHubAuthState | null
  onSignedIn: () => void
  onContinue: () => void
}

export function SignInStep({ authState, onSignedIn, onContinue }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  if (authState?.authenticated) {
    return (
      <div className="space-y-4">
        <div className="text-sm">
          ✓ Signed in as <strong>@{authState.login}</strong>
        </div>
        <button
          onClick={onContinue}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        claudesync needs access to your GitHub to create a repo and push your config.
      </p>
      <button
        onClick={() => setModalOpen(true)}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Sign in with GitHub
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
