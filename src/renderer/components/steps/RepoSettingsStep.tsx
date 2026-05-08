import React, { useEffect, useState } from 'react'
import type { GitHubOwner } from '@shared/api'

export type RepoSettings = {
  owner: string
  name: string
  isPrivate: boolean
  description: string
}

type Props = {
  initial?: Partial<RepoSettings>
  onBack: () => void
  onContinue: (settings: RepoSettings) => void
}

const NAME_RE = /^[a-zA-Z0-9._-]+$/

export function RepoSettingsStep({ initial, onBack, onContinue }: Props) {
  const [owner, setOwner] = useState(initial?.owner ?? '')
  const [name, setName] = useState(initial?.name ?? 'claudesync-config')
  const [isPrivate, setIsPrivate] = useState(initial?.isPrivate ?? true)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [owners, setOwners] = useState<GitHubOwner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api
      .listOwners()
      .then((list) => {
        setOwners(list)
        if (!owner && list.length > 0) setOwner(list[0]!.login)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, []) // intentionally runs once on mount; `owner` initial value captured via closure

  const valid = owner !== '' && NAME_RE.test(name)

  if (loading) return <div className="p-4 text-sm text-neutral-500">Loading owners…</div>
  if (error) return <div className="p-4 text-sm text-red-500">{error}</div>

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Repo name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        {!NAME_RE.test(name) && (
          <div className="mt-1 text-xs text-red-500">
            Only letters, digits, dot, dash, underscore
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">Owner</label>
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        >
          {owners.map((o) => (
            <option key={o.login} value={o.login}>
              {o.login} ({o.type === 'User' ? 'personal' : 'org'})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">Visibility</label>
        <div className="flex gap-4 text-sm">
          <label>
            <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} /> Public
          </label>
          <label>
            <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} /> Private
          </label>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          Back
        </button>
        <button
          disabled={!valid}
          onClick={() => onContinue({ owner, name, isPrivate, description })}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
