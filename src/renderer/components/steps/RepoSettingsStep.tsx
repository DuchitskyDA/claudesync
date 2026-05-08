import React, { useEffect, useState } from 'react'
import type { GitHubOwner } from '@shared/api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useT } from '../../i18n'

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
  const t = useT()
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
  }, [])

  const valid = owner !== '' && NAME_RE.test(name)

  if (loading) return <div className="p-4 text-sm text-muted-foreground">{t('init.repoSettings.loadingOwners')}</div>
  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="repo-name">{t('init.repoSettings.name')}</Label>
        <Input
          id="repo-name"
          value={name}
          placeholder={t('init.repoSettings.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
        {name !== '' && !NAME_RE.test(name) && (
          <div className="text-xs text-destructive">{t('init.repoSettings.error.nameInvalid')}</div>
        )}
        {name === '' && (
          <div className="text-xs text-destructive">{t('init.repoSettings.error.nameRequired')}</div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="repo-owner">{t('init.repoSettings.owner')}</Label>
        <select
          id="repo-owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {owners.map((o) => (
            <option key={o.login} value={o.login}>
              {o.login} ({o.type === 'User' ? 'personal' : 'org'})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>{t('init.repoSettings.visibility')}</Label>
        <div className="flex gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={!isPrivate}
              onChange={() => setIsPrivate(false)}
              className="accent-primary"
            />
            {t('init.repoSettings.public')}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={isPrivate}
              onChange={() => setIsPrivate(true)}
              className="accent-primary"
            />
            {t('init.repoSettings.private')}
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="repo-desc">{t('init.repoSettings.description')}</Label>
        <Input
          id="repo-desc"
          value={description}
          placeholder={t('init.repoSettings.descriptionPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>{t('init.nav.back')}</Button>
        <Button
          disabled={!valid}
          onClick={() => onContinue({ owner, name, isPrivate, description })}
        >
          {t('init.nav.next')}
        </Button>
      </div>
    </div>
  )
}
