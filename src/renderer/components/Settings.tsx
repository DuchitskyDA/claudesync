import React, { useEffect, useState } from 'react'
import type { GitHubAuthState, LocalizedMessage, UpdateInfo } from '@shared/api'
import { DeviceFlowModal } from './DeviceFlowModal'
import { useT, useLocale, SUPPORTED, tMessage } from '../i18n'

type Props = {
  open: boolean
  initial: { repoUrl: string | null; repoPath: string | null; rulesTarget: string | null }
  authState: GitHubAuthState | null
  updateInfo: UpdateInfo | null
  onCheckForUpdates: () => Promise<void>
  onClose: () => void
  onSaved: (cfg: { repoUrl: string | null; repoPath: string | null; rulesTarget: string }) => void
  onSignOut: () => Promise<void>
  onSignedIn: () => void
}

const inputCls =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100'

const ghostBtnCls =
  'rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'

export function Settings({ open, initial, authState, updateInfo, onCheckForUpdates, onClose, onSaved, onSignOut, onSignedIn }: Props) {
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

  if (!open) return null

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
        rulesTarget: trimmedTarget || null,
        includeSecretsInPush: false,
        locale: preference,
        lastDismissedUpdate: existing.lastDismissedUpdate,
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
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[88vh] w-[560px] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <h2 className="font-display text-base font-semibold tracking-tight">
            {t('settings.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <Field
              label={t('settings.repoUrl.label')}
              hint={t('settings.repoUrl.optionalHint')}
            >
              <input
                type="text"
                value={url}
                onChange={(e) => { void onUrlChange(e.target.value) }}
                placeholder={t('settings.repoUrl.placeholder')}
                className={`font-mono ${inputCls}`}
              />
            </Field>

            <Field
              label={t('settings.target.label')}
              hint={t('settings.target.requiredHint')}
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder={placeholderTarget || t('settings.target.placeholder')}
                  className={`font-mono ${inputCls}`}
                />
                <button type="button" onClick={() => browse(setTarget)} className={ghostBtnCls}>
                  {t('settings.browse')}
                </button>
              </div>
            </Field>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-neutral-500 transition hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                {showAdvanced ? '▾' : '▸'} {t('settings.advanced.toggle')}
              </button>

              {showAdvanced && (
                <div className="mt-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
                  <Field
                    label={t('settings.localRepo.label')}
                    hint={t('settings.localRepo.hint')}
                  >
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder={t('settings.localRepo.placeholder')}
                        className={`font-mono ${inputCls}`}
                      />
                      <button type="button" onClick={() => browse(setPath)} className={ghostBtnCls}>
                        {t('settings.browse')}
                      </button>
                    </div>
                  </Field>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {tMessage(t, error)}
              </div>
            )}

            <Section title={t('settings.github.title')}>
              {authState?.authenticated ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {t('settings.github.signedInAs', { login: authState.login ?? '' })}
                  </span>
                  <button
                    onClick={() => void onSignOut()}
                    className="text-xs text-neutral-500 transition hover:underline"
                  >
                    {t('settings.github.signOut')}
                  </button>
                </div>
              ) : (
                <button onClick={() => setDeviceFlowOpen(true)} className={ghostBtnCls}>
                  {t('settings.github.signIn')}
                </button>
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
                    />
                    {t(`settings.language.${loc}`)}
                  </label>
                ))}
              </div>
            </Section>

            <Section title={t('settings.updates.title')}>
              <UpdatesPanel
                info={updateInfo}
                onCheck={onCheckForUpdates}
              />
            </Section>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-700">
          <button onClick={onClose} className={ghostBtnCls}>
            {t('common.cancel')}
          </button>
          <button
            onClick={save}
            disabled={busy || !canSave}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none dark:disabled:bg-neutral-700"
          >
            {t('common.save')}
          </button>
        </div>
      </div>

      <DeviceFlowModal
        open={deviceFlowOpen}
        onClose={() => setDeviceFlowOpen(false)}
        onSuccess={() => {
          setDeviceFlowOpen(false)
          onSignedIn()
        }}
      />
    </div>
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
    <div>
      <label className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
        {hint && <span className="text-xs text-neutral-400">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-neutral-200 pt-4 dark:border-neutral-700">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h3>
      {children}
    </div>
  )
}

function UpdatesPanel({
  info,
  onCheck,
}: {
  info: UpdateInfo | null
  onCheck: () => Promise<void>
}) {
  const t = useT()
  const [checking, setChecking] = useState(false)

  const handle = async () => {
    setChecking(true)
    try {
      await onCheck()
    } finally {
      setChecking(false)
    }
  }

  const renderStatus = (): string => {
    if (!info) return t('settings.updates.notChecked')
    if (info.available && info.latest) {
      return t('settings.updates.available', {
        current: info.current,
        latest: info.latest,
      })
    }
    return t('settings.updates.upToDate', { current: info.current })
  }

  const renderLastChecked = (): string | null => {
    if (!info?.checkedAt) return null
    const ago = formatRelative(info.checkedAt)
    return t('settings.updates.lastChecked', { time: ago })
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 text-sm">
        <div className={info?.available ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-700 dark:text-neutral-200'}>
          {renderStatus()}
        </div>
        {renderLastChecked() && (
          <div className="mt-0.5 text-xs text-neutral-500">{renderLastChecked()}</div>
        )}
      </div>
      <button
        onClick={() => void handle()}
        disabled={checking}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        {checking ? t('settings.updates.checking') : t('settings.updates.checkNow')}
      </button>
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
