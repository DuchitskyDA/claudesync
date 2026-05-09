import React, { useEffect, useState } from 'react'
import type { GitHubAuthState, LocalizedMessage, UpdateInfo } from '@shared/api'
import { ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import type { UpdaterKind } from '../hooks/useAppState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Separator } from './ui/separator'
import { DeviceFlowModal } from './DeviceFlowModal'
import { useT, useLocale, SUPPORTED, tMessage } from '../i18n'

type Props = {
  open: boolean
  initial: { repoUrl: string | null; repoPath: string | null; rulesTarget: string | null }
  authState: GitHubAuthState | null
  updateInfo: UpdateInfo | null
  platform: NodeJS.Platform | null
  arch: NodeJS.Architecture | null
  updaterKind: UpdaterKind
  onCheckForUpdates: () => Promise<void>
  onStartUpdater: () => void
  onClose: () => void
  onSaved: (cfg: { repoUrl: string | null; repoPath: string | null; rulesTarget: string }) => void
  onSignOut: () => Promise<void>
  onSignedIn: () => void
}

export function Settings({ open, initial, authState, updateInfo, platform, arch, updaterKind, onCheckForUpdates, onStartUpdater, onClose, onSaved, onSignOut, onSignedIn }: Props) {
  const [url, setUrl] = useState(initial.repoUrl ?? '')
  const [path, setPath] = useState(initial.repoPath ?? '')
  const [target, setTarget] = useState(initial.rulesTarget ?? '')
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [placeholderTarget, setPlaceholderTarget] = useState('')
  const [deviceFlowOpen, setDeviceFlowOpen] = useState(false)
  const t = useT()
  const { preference, setPreference } = useLocale()

  useEffect(() => {
    if (open) {
      setUrl(initial.repoUrl ?? '')
      setPath(initial.repoPath ?? '')
      setTarget(initial.rulesTarget ?? '')
      setError(null)
      if (!initial.rulesTarget) {
        void window.api.detectRulesTarget().then((detected) => {
          if (detected) setTarget(detected)
        })
      }
      void window.api.suggestRulesTarget().then(setPlaceholderTarget)
    }
  }, [open, initial.repoUrl, initial.repoPath, initial.rulesTarget])

  const browse = async (setter: (s: string) => void) => {
    const picked = await window.api.pickRepoPath()
    if (picked) {
      setter(picked)
      setError(null)
    }
  }

  const onUrlChange = async (newUrl: string) => {
    setUrl(newUrl)
    setError(null)
    if (newUrl.trim() && !path.trim()) {
      const suggested = await window.api.suggestRepoPath(newUrl)
      setPath(suggested)
    }
  }

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const trimmedUrl = url.trim()
      const trimmedTarget = target.trim()
      let finalPath: string | null = path.trim() || null
      if (trimmedUrl && !finalPath) {
        finalPath = await window.api.suggestRepoPath(trimmedUrl)
      }
      if (!trimmedUrl) finalPath = null
      const existing = await window.api.getConfig()
      const r = await window.api.setConfig({
        repoUrl: trimmedUrl || null,
        repoPath: finalPath,
        includeSecretsInPush: false,
        locale: preference,
        lastDismissedUpdate: existing.lastDismissedUpdate,
        claude: { enabled: !!trimmedTarget, path: trimmedTarget || null },
        cursor: existing.cursor,
      })
      if (!r.ok) {
        setError(r.error ?? { key: 'settings.error.unknown' })
        return
      }
      onSaved({ repoUrl: trimmedUrl || null, repoPath: finalPath, rulesTarget: trimmedTarget })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const canSave = target.trim() !== ''

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('settings.title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Field label={t('settings.repoUrl.label')} hint={t('settings.repoUrl.optionalHint')}>
              <Input
                value={url}
                onChange={(e) => { void onUrlChange(e.target.value) }}
                placeholder={t('settings.repoUrl.placeholder')}
                className="font-mono"
              />
            </Field>

            <Field label={t('settings.target.label')} hint={t('settings.target.requiredHint')}>
              <div className="flex gap-2">
                <Input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder={placeholderTarget || t('settings.target.placeholder')}
                  className="font-mono"
                />
                <Button type="button" variant="outline" onClick={() => browse(setTarget)}>
                  {t('settings.browse')}
                </Button>
              </div>
            </Field>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {t('settings.advanced.toggle')}
              </button>
              {showAdvanced && (
                <div className="mt-2 rounded-md border p-3">
                  <Field label={t('settings.localRepo.label')} hint={t('settings.localRepo.hint')}>
                    <div className="flex gap-2">
                      <Input
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder={t('settings.localRepo.placeholder')}
                        className="font-mono"
                      />
                      <Button type="button" variant="outline" onClick={() => browse(setPath)}>
                        {t('settings.browse')}
                      </Button>
                    </div>
                  </Field>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {tMessage(t, error)}
              </div>
            )}

            <Section title={t('settings.github.title')}>
              {authState?.authenticated ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {t('settings.github.signedInAs', { login: authState.login ?? '' })}
                  </span>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void onSignOut()}>
                    {t('settings.github.signOut')}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setDeviceFlowOpen(true)}>
                  {t('settings.github.signIn')}
                </Button>
              )}
            </Section>

            <Section title={t('settings.language.title')}>
              <div className="flex flex-col gap-1.5 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="locale"
                    checked={preference === null}
                    onChange={() => void setPreference(null)}
                    className="accent-primary"
                  />
                  {t('settings.language.system')}
                </label>
                {SUPPORTED.map((loc) => (
                  <label key={loc} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="locale"
                      checked={preference === loc}
                      onChange={() => void setPreference(loc)}
                      className="accent-primary"
                    />
                    {t(`settings.language.${loc}`)}
                  </label>
                ))}
              </div>
            </Section>

            <Section title={t('settings.updates.title')}>
              <UpdatesPanel
                info={updateInfo}
                platform={platform}
                arch={arch}
                updaterKind={updaterKind}
                onCheck={onCheckForUpdates}
                onStartUpdater={onStartUpdater}
              />
            </Section>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={busy || !canSave}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeviceFlowModal
        open={deviceFlowOpen}
        onClose={() => setDeviceFlowOpen(false)}
        onSuccess={() => {
          setDeviceFlowOpen(false)
          onSignedIn()
        }}
      />
    </>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Separator className="mb-4" />
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}

const RELEASE_BASE = 'https://github.com/DuchitskyDA/claudesync/releases/download'

function downloadUrlFor(
  platform: NodeJS.Platform | null,
  arch: NodeJS.Architecture | null,
  version: string,
): string | null {
  if (!platform) return null
  const base = `${RELEASE_BASE}/v${version}`
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? `${base}/claudesync-${version}-arm64.dmg`
      : `${base}/claudesync-${version}.dmg`
  }
  if (platform === 'win32') return `${base}/claudesync.Setup.${version}.exe`
  if (platform === 'linux') return `${base}/claudesync-${version}.AppImage`
  return null
}

function UpdatesPanel({
  info,
  platform,
  arch,
  updaterKind,
  onCheck,
  onStartUpdater,
}: {
  info: UpdateInfo | null
  platform: NodeJS.Platform | null
  arch: NodeJS.Architecture | null
  updaterKind: UpdaterKind
  onCheck: () => Promise<void>
  onStartUpdater: () => void
}) {
  const t = useT()
  const [checking, setChecking] = useState(false)

  const handleCheck = async () => {
    setChecking(true)
    try {
      await onCheck()
    } finally {
      setChecking(false)
    }
  }

  const renderLastChecked = (): string | null => {
    if (!info?.checkedAt) return null
    return t('settings.updates.lastChecked', { time: formatRelative(info.checkedAt) })
  }

  // 1. Update is available — render the action card.
  if (info?.available && info.latest) {
    const oneClick = updaterKind === 'auto' || updaterKind === 'brew'
    const handle = () => {
      if (oneClick) {
        onStartUpdater()
      } else {
        const url = downloadUrlFor(platform, arch, info.latest!)
        if (url) void window.api.openExternal(url)
      }
    }
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={handle}
          className="group flex w-full items-center gap-3 rounded-lg border bg-primary/5 px-3 py-2.5 text-left transition hover:bg-primary/10"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <ArrowUp className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {t('settings.updates.updateTo', { latest: info.latest })}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {t('settings.updates.fromCurrent', { current: info.current })}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </button>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{renderLastChecked() ?? ' '}</span>
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={checking}
            className="text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-60"
          >
            {checking ? t('settings.updates.checking') : t('settings.updates.checkNow')}
          </button>
        </div>
      </div>
    )
  }

  // 2. No update — minimal status row + Check now.
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 text-sm">
        <div className="text-foreground">
          {info
            ? t('settings.updates.upToDate', { current: info.current })
            : t('settings.updates.notChecked')}
        </div>
        {renderLastChecked() && (
          <div className="mt-0.5 text-xs text-muted-foreground">{renderLastChecked()}</div>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => void handleCheck()} disabled={checking}>
        {checking ? t('settings.updates.checking') : t('settings.updates.checkNow')}
      </Button>
    </div>
  )
}

function formatRelative(ms: number): string {
  const diff = Math.max(0, Date.now() - ms)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}
