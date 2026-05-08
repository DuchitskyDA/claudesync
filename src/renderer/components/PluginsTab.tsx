import React, { useEffect, useState } from 'react'
import type {
  PluginCatalog,
  InstalledPluginsState,
  ClaudeTargetCheck,
  PluginEntry,
  PresetEntry,
  PluginEnvRequirement,
} from '@shared/api'
import { EnvPromptModal } from './EnvPromptModal'
import { useT, tMessage } from '../i18n'

// ---------------------------------------------------------------------------
// Badge helper
// ---------------------------------------------------------------------------

type BadgeTone = 'green' | 'amber'

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const cls =
    tone === 'green'
      ? 'rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : 'rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
  return <span className={cls}>{children}</span>
}

// ---------------------------------------------------------------------------
// Env modal state
// ---------------------------------------------------------------------------

type EnvModalState = {
  plugin: PluginEntry
  requirement: PluginEnvRequirement
  /** remaining plugins to enable in this batch (includes current plugin) */
  pendingPlugins: PluginEntry[]
  collectedEnv: Record<string, string>
  disable: string[]
  /** "edit" mode — only update env, do not enable/disable anything */
  editOnly?: boolean
}

// ---------------------------------------------------------------------------
// PluginsTab
// ---------------------------------------------------------------------------

export function PluginsTab() {
  const t = useT()
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null)
  const [installed, setInstalled] = useState<InstalledPluginsState | null>(null)
  const [target, setTarget] = useState<ClaudeTargetCheck | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [envModal, setEnvModal] = useState<EnvModalState | null>(null)
  const [showRestart, setShowRestart] = useState(false)

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Core helpers
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Batch / env-queue helpers
  // -------------------------------------------------------------------------

  /**
   * Start a batch enable for `plugins`. Walks through and opens env modal for
   * first plugin that has an unset env requirement. If none, applies directly.
   */
  const startBatch = (plugins: PluginEntry[], disable: string[]) => {
    const first = plugins.find((p) =>
      (p.requiresEnv ?? []).some((r) => !installed!.envSet.includes(r.name)),
    )
    if (!first) {
      void applyChanges(plugins, disable, {})
      return
    }
    const req = (first.requiresEnv ?? []).find((r) => !installed!.envSet.includes(r.name))!
    setEnvModal({
      plugin: first,
      requirement: req,
      pendingPlugins: plugins,
      collectedEnv: {},
      disable,
    })
  }

  const handleEnvSave = (value: string) => {
    if (!envModal) return
    const { plugin, requirement, pendingPlugins, collectedEnv, disable, editOnly } = envModal
    const newEnv = { ...collectedEnv, [requirement.name]: value }

    if (editOnly) {
      // Just update the env value, no enable/disable
      setEnvModal(null)
      void applyChanges([], [], newEnv)
      return
    }

    // Find next plugin in batch that still has an unmet env requirement
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

    // All env collected
    setEnvModal(null)
    void applyChanges(pendingPlugins, disable, newEnv)
  }

  const handleEnvSkip = () => {
    if (!envModal) return
    const { plugin, pendingPlugins, collectedEnv, disable } = envModal
    const remaining = pendingPlugins.filter((p) => p.id !== plugin.id)

    if (remaining.length === 0) {
      setEnvModal(null)
      // Apply whatever was collected (may be empty)
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

  // -------------------------------------------------------------------------
  // Plugin card actions
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Preset card actions
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Marketplace conflict detection
  // -------------------------------------------------------------------------

  const computeConflicts = () => {
    if (!catalog || !installed) return []
    const seen = new Set<string>()
    const result: Array<{ id: string; expected: { source: string; repo: string }; actual: { source: string; repo: string } }> = []
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

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  if (!target?.ok) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        {t('plugins.noTarget')}{' '}
        {target?.ok === false ? target.reason : ''}
      </div>
    )
  }

  if (!catalog || !installed) {
    return <div className="p-6 text-sm text-neutral-500">{t('plugins.loading')}</div>
  }

  const conflicts = computeConflicts()

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-4 p-4">
      {/* Env modal */}
      {envModal !== null && (
        <EnvPromptModal
          pluginName={envModal.plugin.name}
          requirement={envModal.requirement}
          onSkip={handleEnvSkip}
          onSave={handleEnvSave}
        />
      )}

      {/* Restart toast */}
      {showRestart && (
        <div className="rounded bg-blue-50 p-2 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          {t('plugins.restart')}
        </div>
      )}

      {/* Marketplace conflict banner */}
      {conflicts.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong>⚠ {t('plugins.conflict.title')}</strong>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((c) => (
              <li key={c.id}>
                {t('plugins.conflict.item', { id: c.id, actual: c.actual.repo, expected: c.expected.repo })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500">{t('plugins.topbar.settings', { path: target.settingsPath })}</div>
        <button
          onClick={() => load(true)}
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {t('plugins.topbar.refresh')}
        </button>
      </div>

      {/* Presets */}
      {catalog.presets.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
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
                <div
                  key={preset.id}
                  className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
                >
                  <div className="font-medium">{preset.name}</div>
                  <div className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
                    {preset.description}
                  </div>
                  <div className="mb-3 text-xs text-neutral-500">
                    {installedCount === total
                      ? t('plugins.preset.allInstalled')
                      : t('plugins.preset.progress', { installed: installedCount, total })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {installedCount < total && (
                      <button
                        onClick={() => activatePreset(preset)}
                        disabled={presetBusy}
                        className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:bg-neutral-400"
                      >
                        {installedCount === 0
                          ? t('plugins.preset.activateAll')
                          : t('plugins.preset.activateMissing', { count: total - installedCount })}
                      </button>
                    )}
                    {installedCount > 0 && (
                      <button
                        onClick={() => removePreset(preset)}
                        disabled={presetBusy}
                        className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        {installedCount === total ? t('plugins.preset.removeAll') : t('plugins.preset.removePreset')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Plugins */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
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
                className="flex items-start gap-3 rounded border border-neutral-200 p-3 dark:border-neutral-700"
              >
                {/* Left: info */}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {isInstalled && envOk && <Badge tone="green">{t('plugins.card.installed')}</Badge>}
                    {isInstalled && !envOk && <Badge tone="amber">{t('plugins.card.envMissing')}</Badge>}
                    {p.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400">
                    {p.description}
                  </div>
                  {p.homepage && (
                    <a
                      href={p.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-500 hover:underline"
                    >
                      {p.homepage}
                    </a>
                  )}
                </div>

                {/* Right: actions */}
                <div className="flex flex-col items-end gap-1">
                  {!isInstalled && (
                    <button
                      onClick={() => installPlugin(p)}
                      disabled={busy}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:bg-neutral-400"
                    >
                      {busy ? t('plugins.card.installing') : t('plugins.card.install')}
                    </button>
                  )}
                  {isInstalled && !envOk && (
                    <button
                      onClick={() => installPlugin(p)}
                      disabled={busy}
                      className="rounded bg-amber-500 px-3 py-1 text-xs text-white hover:bg-amber-600 disabled:bg-neutral-400"
                    >
                      {busy ? t('plugins.card.installing') : t('plugins.card.setKey')}
                    </button>
                  )}
                  {isInstalled && (
                    <button
                      onClick={() => removePlugin(p)}
                      disabled={busy}
                      className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      {busy ? t('plugins.card.installing') : t('plugins.card.remove')}
                    </button>
                  )}
                  {isInstalled && envOk && p.requiresEnv && p.requiresEnv.length > 0 && (
                    <button
                      onClick={() => editApiKey(p)}
                      className="text-xs text-neutral-500 hover:underline"
                    >
                      {t('plugins.card.editApiKey')}
                    </button>
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
