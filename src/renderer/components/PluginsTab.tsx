import React, { useEffect, useState } from 'react'
import type {
  PluginCatalog,
  InstalledPluginsState,
  ClaudeTargetCheck,
  PluginEntry,
  PresetEntry,
  PluginEnvRequirement,
} from '@shared/api'
import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card'
import { EnvPromptModal } from './EnvPromptModal'
import { useT, tMessage } from '../i18n'

type EnvModalState = {
  plugin: PluginEntry
  requirement: PluginEnvRequirement
  pendingPlugins: PluginEntry[]
  collectedEnv: Record<string, string>
  disable: string[]
  editOnly?: boolean
}

export function PluginsTab() {
  const t = useT()
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null)
  const [installed, setInstalled] = useState<InstalledPluginsState | null>(null)
  const [target, setTarget] = useState<ClaudeTargetCheck | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [envModal, setEnvModal] = useState<EnvModalState | null>(null)
  const [showRestart, setShowRestart] = useState(false)

  const load = (force?: boolean) => {
    void window.api.validateClaudeTarget().then(setTarget)
    void window.api
      .getPluginCatalog(force)
      .then(setCatalog)
      .catch(() => setCatalog(null))
    void window.api.getInstalledPlugins().then(setInstalled)
  }

  useEffect(() => {
    load()
  }, [])

  const refreshInstalled = async () => {
    const fresh = await window.api.getInstalledPlugins()
    setInstalled(fresh)
  }

  const applyChanges = async (
    enable: PluginEntry[],
    disable: string[],
    envValues: Record<string, string>,
  ): Promise<boolean> => {
    const r = await window.api.applyPluginChanges({ enable, disable, envValues })
    if (r.ok) {
      setShowRestart(true)
      await refreshInstalled()
    } else {
      alert(tMessage(t, r.error) || t('plugins.error.apply', { reason: String(r.error ?? '') }))
    }
    return r.ok
  }

  const runWithBusy = async (id: string, fn: () => Promise<boolean>) => {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await fn()
    } finally {
      setBusyIds((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
    }
  }

  const startBatch = (plugins: PluginEntry[], disable: string[]) => {
    const first = plugins.find((p) =>
      (p.requiresEnv ?? []).some((r) => !installed!.envSet.includes(r.name)),
    )
    if (!first) {
      void applyChanges(plugins, disable, {})
      return
    }
    const req = (first.requiresEnv ?? []).find((r) => !installed!.envSet.includes(r.name))!
    setEnvModal({ plugin: first, requirement: req, pendingPlugins: plugins, collectedEnv: {}, disable })
  }

  const handleEnvSave = (value: string) => {
    if (!envModal) return
    const { plugin, requirement, pendingPlugins, collectedEnv, disable, editOnly } = envModal
    const newEnv = { ...collectedEnv, [requirement.name]: value }

    if (editOnly) {
      setEnvModal(null)
      void applyChanges([], [], newEnv)
      return
    }

    const remaining = pendingPlugins.filter((p) => p.id !== plugin.id)
    const nextPlugin = remaining.find((p) =>
      (p.requiresEnv ?? []).some((r) => !newEnv[r.name] && !installed!.envSet.includes(r.name)),
    )

    if (nextPlugin) {
      const nextReq = (nextPlugin.requiresEnv ?? []).find(
        (r) => !newEnv[r.name] && !installed!.envSet.includes(r.name),
      )!
      setEnvModal({
        plugin: nextPlugin,
        requirement: nextReq,
        pendingPlugins,
        collectedEnv: newEnv,
        disable,
      })
      return
    }

    setEnvModal(null)
    void applyChanges(pendingPlugins, disable, newEnv)
  }

  const handleEnvSkip = () => {
    if (!envModal) return
    const { plugin, pendingPlugins, collectedEnv, disable } = envModal
    const remaining = pendingPlugins.filter((p) => p.id !== plugin.id)

    if (remaining.length === 0) {
      setEnvModal(null)
      void applyChanges([], disable, collectedEnv)
      return
    }

    const nextPlugin = remaining.find((p) =>
      (p.requiresEnv ?? []).some(
        (r) => !collectedEnv[r.name] && !installed!.envSet.includes(r.name),
      ),
    )

    if (nextPlugin) {
      const nextReq = (nextPlugin.requiresEnv ?? []).find(
        (r) => !collectedEnv[r.name] && !installed!.envSet.includes(r.name),
      )!
      setEnvModal({
        plugin: nextPlugin,
        requirement: nextReq,
        pendingPlugins: remaining,
        collectedEnv,
        disable,
      })
    } else {
      setEnvModal(null)
      void applyChanges(remaining, disable, collectedEnv)
    }
  }

  const installPlugin = (p: PluginEntry) => {
    if (!installed) return
    const missingEnvs = (p.requiresEnv ?? []).filter((r) => !installed.envSet.includes(r.name))
    if (missingEnvs.length > 0) {
      setEnvModal({
        plugin: p,
        requirement: missingEnvs[0]!,
        pendingPlugins: [p],
        collectedEnv: {},
        disable: [],
      })
      return
    }
    void runWithBusy(p.id, () => applyChanges([p], [], {}))
  }

  const removePlugin = (p: PluginEntry) => {
    void runWithBusy(p.id, () => applyChanges([], [p.id], {}))
  }

  const editApiKey = (p: PluginEntry) => {
    if (!p.requiresEnv || p.requiresEnv.length === 0) return
    setEnvModal({
      plugin: p,
      requirement: p.requiresEnv[0]!,
      pendingPlugins: [p],
      collectedEnv: {},
      disable: [],
      editOnly: true,
    })
  }

  const activatePreset = (preset: PresetEntry) => {
    if (!catalog || !installed) return
    const missing = preset.pluginIds
      .map((id) => catalog.plugins.find((p) => p.id === id))
      .filter((p): p is PluginEntry => !!p)
      .filter((p) => !installed.enabledIds.includes(p.id))
    if (missing.length === 0) return
    startBatch(missing, [])
  }

  const removePreset = (preset: PresetEntry) => {
    if (!installed) return
    const toRemove = preset.pluginIds.filter((id) => installed.enabledIds.includes(id))
    void runWithBusy(`preset:${preset.id}`, () => applyChanges([], toRemove, {}))
  }

  const computeConflicts = () => {
    if (!catalog || !installed) return []
    const seen = new Set<string>()
    const result: Array<{
      id: string
      expected: { source: string; repo: string }
      actual: { source: string; repo: string }
    }> = []
    for (const plugin of catalog.plugins) {
      if (!plugin.marketplace) continue
      const m = plugin.marketplace
      if (seen.has(m.id)) continue
      seen.add(m.id)
      const actual = installed.marketplaceSources[m.id]
      if (actual && actual.repo !== m.source.repo) {
        result.push({ id: m.id, expected: m.source, actual })
      }
    }
    return result
  }

  if (!target?.ok) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t('plugins.noTarget')} {target?.ok === false ? target.reason : ''}
      </div>
    )
  }

  if (!catalog || !installed) {
    return <div className="p-6 text-sm text-muted-foreground">{t('plugins.loading')}</div>
  }

  const conflicts = computeConflicts()

  return (
    <div className="space-y-4 p-4">
      {envModal !== null && (
        <EnvPromptModal
          pluginName={envModal.plugin.name}
          requirement={envModal.requirement}
          onSkip={handleEnvSkip}
          onSave={handleEnvSave}
        />
      )}

      {showRestart && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
          {t('plugins.restart')}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {t('plugins.conflict.title')}
          </div>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((c) => (
              <li key={c.id}>
                {t('plugins.conflict.item', {
                  id: c.id,
                  actual: c.actual.repo,
                  expected: c.expected.repo,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {t('plugins.topbar.settings', { path: target.settingsPath })}
        </div>
        <Button variant="ghost" size="sm" onClick={() => load(true)} className="h-7 text-xs">
          {t('plugins.topbar.refresh')}
        </Button>
      </div>

      {catalog.presets.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('plugins.section.presets')}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {catalog.presets.map((preset) => {
              const installedCount = preset.pluginIds.filter((id) =>
                installed.enabledIds.includes(id),
              ).length
              const total = preset.pluginIds.length
              const presetBusy = busyIds.has(`preset:${preset.id}`)

              return (
                <Card key={preset.id}>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">{preset.name}</CardTitle>
                    <CardDescription className="text-xs">{preset.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 pb-2">
                    <div className="text-xs text-muted-foreground">
                      {installedCount === total
                        ? t('plugins.preset.allInstalled')
                        : t('plugins.preset.progress', { installed: installedCount, total })}
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2 p-4 pt-2">
                    {installedCount < total && (
                      <Button size="sm" onClick={() => activatePreset(preset)} disabled={presetBusy}>
                        {installedCount === 0
                          ? t('plugins.preset.activateAll')
                          : t('plugins.preset.activateMissing', { count: total - installedCount })}
                      </Button>
                    )}
                    {installedCount > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removePreset(preset)}
                        disabled={presetBusy}
                      >
                        {installedCount === total
                          ? t('plugins.preset.removeAll')
                          : t('plugins.preset.removePreset')}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('plugins.section.plugins')}
        </h3>
        <ul className="space-y-2">
          {catalog.plugins.map((p) => {
            const isInstalled = installed.enabledIds.includes(p.id)
            const envOk =
              !p.requiresEnv ||
              p.requiresEnv.every((r) => r.optional || installed.envSet.includes(r.name))
            const busy = busyIds.has(p.id)

            return (
              <li
                key={p.id}
                className="flex items-start gap-3 rounded-lg border bg-card p-3"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {isInstalled && envOk && (
                      <Badge variant="success">{t('plugins.card.installed')}</Badge>
                    )}
                    {isInstalled && !envOk && (
                      <Badge variant="warning">{t('plugins.card.envMissing')}</Badge>
                    )}
                    {p.tags?.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-sm text-muted-foreground">{p.description}</div>
                  {p.homepage && (
                    <a
                      href={p.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      {p.homepage}
                    </a>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1">
                  {!isInstalled && (
                    <Button size="sm" onClick={() => installPlugin(p)} disabled={busy}>
                      {busy ? t('plugins.card.installing') : t('plugins.card.install')}
                    </Button>
                  )}
                  {isInstalled && !envOk && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => installPlugin(p)}
                      disabled={busy}
                      className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-500/15 dark:hover:text-amber-200"
                    >
                      {busy ? t('plugins.card.installing') : t('plugins.card.setKey')}
                    </Button>
                  )}
                  {isInstalled && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removePlugin(p)}
                      disabled={busy}
                      className="border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                    >
                      {busy ? t('plugins.card.installing') : t('plugins.card.remove')}
                    </Button>
                  )}
                  {isInstalled && envOk && p.requiresEnv && p.requiresEnv.length > 0 && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={() => editApiKey(p)}
                    >
                      {t('plugins.card.editApiKey')}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
