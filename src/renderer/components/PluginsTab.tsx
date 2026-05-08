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
import { PresetCard } from './PresetCard'

type EnvQueueItem = { plugin: PluginEntry; requirement: PluginEnvRequirement }

export function PluginsTab() {
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null)
  const [installed, setInstalled] = useState<InstalledPluginsState | null>(null)
  const [target, setTarget] = useState<ClaudeTargetCheck | null>(null)
  const [pendingEnabled, setPendingEnabled] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [envQueue, setEnvQueue] = useState<EnvQueueItem[]>([])
  const [pendingEnvValues, setPendingEnvValues] = useState<Record<string, string>>({})
  const [pendingApply, setPendingApply] = useState<{
    enable: PluginEntry[]
    disable: string[]
  } | null>(null)

  const load = (force?: boolean) => {
    void window.api.validateClaudeTarget().then(setTarget)
    void window.api
      .getPluginCatalog(force)
      .then(setCatalog)
      .catch(() => setCatalog(null))
    void window.api.getInstalledPlugins().then((s) => {
      setInstalled(s)
      setPendingEnabled(new Set(s.enabledIds))
    })
  }

  useEffect(() => {
    load()
  }, [])

  const applyChanges = async (
    enable: PluginEntry[],
    disable: string[],
    envValues: Record<string, string>,
  ) => {
    setBusy(true)
    setMessage(null)
    const r = await window.api.applyPluginChanges({ enable, disable, envValues })
    if (r.ok) {
      setMessage('Updated. Restart Claude Code to apply.')
      const fresh = await window.api.getInstalledPlugins()
      setInstalled(fresh)
      setPendingEnabled(new Set(fresh.enabledIds))
    } else {
      setMessage(`Error: ${r.error}`)
    }
    setBusy(false)
    setPendingApply(null)
    setPendingEnvValues({})
  }

  const processEnableList = (enableList: PluginEntry[], disableList: string[]) => {
    const queue: EnvQueueItem[] = []
    for (const plugin of enableList) {
      if (!plugin.requiresEnv) continue
      for (const req of plugin.requiresEnv) {
        if (!installed?.envSet.includes(req.name)) {
          queue.push({ plugin, requirement: req })
        }
      }
    }
    setPendingApply({ enable: enableList, disable: disableList })
    if (queue.length === 0) {
      void applyChanges(enableList, disableList, {})
    } else {
      setEnvQueue(queue)
    }
  }

  const handleEnvSave = (value: string) => {
    const current = envQueue[0]
    if (!current) return
    const newEnvValues = { ...pendingEnvValues, [current.requirement.name]: value }
    setPendingEnvValues(newEnvValues)
    const remaining = envQueue.slice(1)
    setEnvQueue(remaining)
    if (remaining.length === 0 && pendingApply) {
      void applyChanges(pendingApply.enable, pendingApply.disable, newEnvValues)
    }
  }

  const handleEnvSkip = () => {
    const skipped = envQueue[0]
    if (!skipped) return
    // Remove this plugin from pendingApply.enable
    setPendingApply((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        enable: prev.enable.filter((p) => p.id !== skipped.plugin.id),
      }
    })
    // Also update pendingEnabled to reflect skip
    setPendingEnabled((prev) => {
      const next = new Set(prev)
      next.delete(skipped.plugin.id)
      return next
    })
    const remaining = envQueue.slice(1)
    setEnvQueue(remaining)
    if (remaining.length === 0) {
      setPendingApply((current) => {
        if (!current) return current
        const updatedEnable = current.enable.filter((p) => p.id !== skipped.plugin.id)
        void applyChanges(updatedEnable, current.disable, pendingEnvValues)
        return null
      })
    }
  }

  const toggle = (id: string) => {
    if (!catalog || !installed) return
    const plugin = catalog.plugins.find((p) => p.id === id)
    if (!plugin) return

    const isCurrentlyEnabled = pendingEnabled.has(id)

    if (!isCurrentlyEnabled && plugin.requiresEnv) {
      // Enabling a plugin with env requirements — go through modal flow
      const enable = [plugin]
      const disable: string[] = []
      processEnableList(enable, disable)
      // Also add to pendingEnabled optimistically
      setPendingEnabled((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
    } else {
      setPendingEnabled((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
  }

  const apply = () => {
    if (!catalog || !installed) return
    const enable = catalog.plugins.filter(
      (p) => pendingEnabled.has(p.id) && !installed.enabledIds.includes(p.id),
    )
    const disable = installed.enabledIds.filter((id) => !pendingEnabled.has(id))
    processEnableList(enable, disable)
  }

  const applyPreset = (preset: PresetEntry) => {
    if (!catalog || !installed) return
    const enableList = preset.pluginIds
      .map((id) => catalog.plugins.find((p) => p.id === id))
      .filter((p): p is PluginEntry => !!p)
      .filter((p) => !installed.enabledIds.includes(p.id))
    // Merge into pendingEnabled
    setPendingEnabled((prev) => {
      const next = new Set(prev)
      for (const p of enableList) next.add(p.id)
      return next
    })
    processEnableList(enableList, [])
  }

  if (!target?.ok) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        Plugin manager requires a configured Rules target.{' '}
        {target?.ok === false ? target.reason : ''}
      </div>
    )
  }

  if (!catalog) {
    return <div className="p-6 text-sm text-neutral-500">Loading catalog…</div>
  }

  const currentEnvItem = envQueue[0] ?? null

  return (
    <div className="space-y-4 p-4">
      {currentEnvItem !== null && (
        <EnvPromptModal
          pluginName={currentEnvItem.plugin.name}
          requirement={currentEnvItem.requirement}
          onSkip={handleEnvSkip}
          onSave={handleEnvSave}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500">Settings: {target.settingsPath}</div>
        <button
          onClick={() => load(true)}
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          Refresh catalog
        </button>
      </div>

      {catalog.presets.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Presets
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {catalog.presets.map((p) => (
              <PresetCard key={p.id} preset={p} onApply={() => applyPreset(p)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Plugins
        </h3>
        <ul className="space-y-2">
          {catalog.plugins.map((p) => (
            <li
              key={p.id}
              className="flex items-start gap-3 rounded border border-neutral-200 p-3 dark:border-neutral-700"
            >
              <input
                type="checkbox"
                checked={pendingEnabled.has(p.id)}
                onChange={() => toggle(p.id)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.tags?.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                    >
                      {t}
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
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={apply}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
        >
          {busy ? 'Applying…' : 'Apply changes'}
        </button>
        {message && (
          <span className="text-sm text-neutral-600 dark:text-neutral-300">{message}</span>
        )}
      </div>
    </div>
  )
}
