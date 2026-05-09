import React, { useEffect, useState } from 'react'
import type { CursorConfig, CursorProject, GitHubAuthState, LocalizedMessage, UpdateInfo } from '@shared/api'
import { ArrowUp, ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
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
import { Tabs as UITabs, TabsList, TabsTrigger } from './ui/tabs'
import { DeviceFlowModal } from './DeviceFlowModal'
import { cn } from '@/lib/utils'
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
  const [cursor, setCursor] = useState<CursorConfig>({ enabled: false, projects: [] })
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [placeholderTarget, setPlaceholderTarget] = useState('')
  const [deviceFlowOpen, setDeviceFlowOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [tab, setTab] = useState<'repo' | 'claude' | 'cursor'>('repo')
  const t = useT()
  const { preference, setPreference } = useLocale()

  useEffect(() => {
    if (open) {
      setUrl(initial.repoUrl ?? '')
      setPath(initial.repoPath ?? '')
      setTarget(initial.rulesTarget ?? '')
      setError(null)
      if (!initial.rulesTarget) {
        void window.api.detectClaudePath().then((detected) => {
          if (detected) setTarget(detected)
        })
      }
      void window.api.suggestClaudePath().then(setPlaceholderTarget)
      void window.api.getConfig().then((c) => {
        setCursor(c.cursor)
      })
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
        cursor,
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

  const canSave = target.trim() !== '' || (cursor.enabled && cursor.projects.length > 0)

  const removeProject = (idx: number) => {
    setCursor((c) => ({ ...c, projects: c.projects.filter((_, i) => i !== idx) }))
  }
  const addProject = (p: CursorProject) => {
    setCursor((c) => ({ ...c, enabled: true, projects: [...c.projects, p] }))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="sm:max-w-[560px] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="border-b bg-background px-6 pt-6 pb-3">
            <DialogHeader className="mb-3">
              <DialogTitle>{t('settings.title')}</DialogTitle>
            </DialogHeader>

            <UITabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="repo" className="flex-1">{t('settings.tabs.repo')}</TabsTrigger>
                <TabsTrigger value="claude" className="flex-1">{t('settings.tabs.claude')}</TabsTrigger>
                <TabsTrigger value="cursor" className="flex-1">{t('settings.tabs.cursor')}</TabsTrigger>
              </TabsList>
            </UITabs>
          </div>

          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {tab === 'repo' && (
              <>
                <Field label={t('settings.repoUrl.label')} hint={t('settings.repoUrl.optionalHint')}>
                  <Input
                    value={url}
                    onChange={(e) => { void onUrlChange(e.target.value) }}
                    placeholder={t('settings.repoUrl.placeholder')}
                    className="font-mono"
                  />
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
              </>
            )}

            {tab === 'claude' && (
              <>
                <p className="text-xs text-muted-foreground">{t('settings.claude.description')}</p>
                <Field label={t('settings.claude.path.label')} hint={t('settings.claude.path.hint')}>
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
              </>
            )}

            {tab === 'cursor' && (
              <>
                <p className="text-xs text-muted-foreground">{t('settings.cursor.description')}</p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cursor.enabled}
                    onChange={(e) => setCursor((c) => ({ ...c, enabled: e.target.checked }))}
                    className="accent-primary"
                  />
                  {t('settings.cursor.enable')}
                </label>
                <div className={cursor.enabled ? '' : 'opacity-50 pointer-events-none'}>
                  {cursor.projects.length === 0 ? (
                    <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      {t('settings.cursor.empty')}
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {cursor.projects.map((p, i) => (
                        <li
                          key={`${p.name}-${i}`}
                          className="flex w-full min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <span className="font-medium shrink-0">{p.name}</span>
                          <span
                            className="block min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                            title={p.path}
                          >
                            {p.path}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeProject(i)}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label={t('settings.cursor.remove')}
                            title={t('settings.cursor.remove')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setAddProjectOpen(true)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {t('settings.cursor.addProject')}
                  </Button>
                </div>
              </>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {tMessage(t, error)}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t bg-background px-6 py-3 sm:justify-end">
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

      <AddCursorProjectDialog
        open={addProjectOpen}
        existingNames={cursor.projects.map((p) => p.name)}
        existingPaths={cursor.projects.map((p) => p.path)}
        onClose={() => setAddProjectOpen(false)}
        onAdd={addProject}
      />
    </>
  )
}

function AddCursorProjectDialog({
  open,
  existingNames,
  existingPaths,
  onClose,
  onAdd,
}: {
  open: boolean
  existingNames: string[]
  existingPaths: string[]
  onClose: () => void
  onAdd: (p: CursorProject) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [unlinkedRepoSubdirs, setUnlinkedRepoSubdirs] = useState<string[]>([])

  useEffect(() => {
    if (!open) {
      setName('')
      setPath('')
      setError(null)
      setUnlinkedRepoSubdirs([])
      return
    }
    void window.api.listRepoCursorSubdirs().then((all) => {
      setUnlinkedRepoSubdirs(all.filter((n) => !existingNames.includes(n)))
    })
  }, [open, existingNames])

  const browse = async () => {
    const p = await window.api.pickCursorProjectPath()
    if (p) {
      setPath(p)
      if (!name.trim()) {
        const parts = p.split(/[\\/]/).filter(Boolean)
        setName(parts[parts.length - 1] ?? '')
      }
    }
  }

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const trimmedName = name.trim()
      const trimmedPath = path.trim()
      if (existingNames.includes(trimmedName)) {
        setError({ key: 'cursor.error.duplicateName', params: { name: trimmedName } })
        return
      }
      if (existingPaths.includes(trimmedPath)) {
        setError({ key: 'cursor.error.duplicatePath', params: { path: trimmedPath } })
        return
      }
      const r = await window.api.validateCursorProject({ name: trimmedName, path: trimmedPath })
      if (!r.ok) {
        setError(r.error)
        return
      }
      // Bootstrap empty .cursor/{rules,skills}/ in the project if missing — lets
      // the user start syncing from scratch even when the project doesn't yet
      // use Cursor.
      try {
        await window.api.bootstrapCursorProject(trimmedPath)
      } catch {
        /* non-fatal */
      }
      onAdd({ name: trimmedName, path: trimmedPath })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('settings.cursor.add.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {unlinkedRepoSubdirs.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-dashed border-sky-500/40 bg-sky-500/5 p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                {t('settings.cursor.add.linkExisting')}
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.cursor.add.linkHint')}</p>
              <div className="flex flex-wrap gap-1.5">
                {unlinkedRepoSubdirs.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => setName(sub)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 font-mono text-xs transition',
                      name === sub
                        ? 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                        : 'border-border hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t('settings.cursor.add.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="myapp" />
          </div>
          <div className="space-y-1.5">
            <Label>{t('settings.cursor.add.path')}</Label>
            <div className="flex gap-2">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/project"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={browse}>
                {t('settings.browse')}
              </Button>
            </div>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {tMessage(t, error)}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !path.trim()}>
            {t('settings.cursor.add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
