import React, { useEffect, useState } from 'react'
import type { McpServerStatus } from '@shared/api'
import { MCP_SERVERS } from '@shared/mcp-registry'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Badge } from './ui/badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select'
import { useT, tMessage } from '../i18n'

function mask(v: string): string {
  if (v.length > 8) {
    return v.slice(0, 4) + '…' + v.slice(-2)
  }
  return '••••'
}

export function McpTab() {
  const t = useT()
  const [projects, setProjects] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState<Record<string, Record<string, string>>>({})
  const [showRestart, setShowRestart] = useState(false)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void window.api.listMcpProjects().then((list) => {
      setProjects(list)
      if (list.length > 0 && list[0] !== undefined) {
        setSelected(list[0])
      }
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setEditing({})
    setForm({})
    const fetchStatuses = async () => {
      const results: Record<string, McpServerStatus> = {}
      for (const def of MCP_SERVERS) {
        if (cancelled) return
        results[def.id] = await window.api.getMcpServer(selected, def.id)
      }
      if (!cancelled) setStatuses(results)
    }
    void fetchStatuses()
    return () => {
      cancelled = true
    }
  }, [selected])

  const handleAddFolder = async () => {
    const path = await window.api.pickProjectPath()
    if (path) {
      setProjects((prev) => (prev.includes(path) ? prev : [...prev, path]))
      setSelected(path)
    }
  }

  const handleInstall = async (serverId: string) => {
    if (!selected) return
    setBusy(serverId)
    try {
      const env = form[serverId] ?? {}
      const r = await window.api.installMcpServer({ projectPath: selected, serverId, env })
      if (r.ok) {
        setShowRestart(true)
        const fresh = await window.api.getMcpServer(selected, serverId)
        setStatuses((prev) => ({ ...prev, [serverId]: fresh }))
        setEditing((prev) => ({ ...prev, [serverId]: false }))
        setForm((prev) => ({ ...prev, [serverId]: {} }))
      } else {
        window.alert(tMessage(t, r.error))
      }
    } finally {
      setBusy(null)
    }
  }

  const handleUninstall = async (serverId: string) => {
    if (!selected) return
    setBusy(serverId)
    try {
      const r = await window.api.uninstallMcpServer(selected, serverId)
      if (r.ok) {
        setShowRestart(true)
        const fresh = await window.api.getMcpServer(selected, serverId)
        setStatuses((prev) => ({ ...prev, [serverId]: fresh }))
      } else {
        window.alert(tMessage(t, r.error))
      }
    } finally {
      setBusy(null)
    }
  }

  const openEditForm = (serverId: string, currentEnv: Record<string, string>) => {
    setForm((prev) => ({ ...prev, [serverId]: { ...currentEnv } }))
    setEditing((prev) => ({ ...prev, [serverId]: true }))
  }

  const setFieldValue = (serverId: string, fieldName: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      [serverId]: { ...(prev[serverId] ?? {}), [fieldName]: value },
    }))
  }

  const toggleReveal = (key: string) => {
    setReveal((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">{t('mcp.project.none')}</p>
        <Button size="sm" onClick={() => void handleAddFolder()}>
          {t('mcp.project.add')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {showRestart && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
          {t('mcp.restart')}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-xs">{t('mcp.project.label')}</Label>
        <Select value={selected ?? undefined} onValueChange={setSelected}>
          <SelectTrigger className="min-w-0 flex-1 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p} value={p} className="font-mono text-xs">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => void handleAddFolder()} className="shrink-0">
          {t('mcp.project.add')}
        </Button>
      </div>

      <div className="space-y-3">
        {MCP_SERVERS.map((def) => {
          const status = statuses[def.id]
          const isBusy = busy === def.id
          const isEditing = editing[def.id] === true
          const formValues = form[def.id] ?? {}
          const allFilled = def.env.every((f) => (formValues[f.name] ?? '').trim() !== '')

          return (
            <Card key={def.id}>
              <CardHeader className="p-4 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">{def.name}</CardTitle>
                  {status?.installed && (
                    <Badge variant="success">{t('mcp.card.connected')}</Badge>
                  )}
                </div>
                <CardDescription className="text-xs">{def.description}</CardDescription>
                {def.docsUrl && (
                  <a
                    href={def.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    {t('mcp.card.docs')}
                  </a>
                )}
              </CardHeader>

              {status?.installed && !isEditing && (
                <CardContent className="p-4 pt-0 pb-2">
                  <div className="space-y-1">
                    {def.env.map((field) => {
                      const val = status.env[field.name] ?? ''
                      return (
                        <div key={field.name} className="text-xs text-muted-foreground">
                          <span className="font-medium">{field.label}:</span>{' '}
                          {field.secret ? mask(val) : val}
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              )}

              {(!status?.installed || isEditing) && (
                <CardContent className="p-4 pt-0 pb-2">
                  <div className="space-y-2">
                    {def.env.map((field) => {
                      const revealKey = `${def.id}:${field.name}`
                      const isRevealed = reveal[revealKey] === true
                      return (
                        <div key={field.name} className="space-y-1">
                          <Label className="text-xs">{field.label}</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type={field.secret && !isRevealed ? 'password' : 'text'}
                              placeholder={field.placeholder}
                              value={formValues[field.name] ?? ''}
                              onChange={(e) => setFieldValue(def.id, field.name, e.target.value)}
                              className="h-8 text-xs"
                            />
                            {field.secret && (
                              <button
                                type="button"
                                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => toggleReveal(revealKey)}
                              >
                                {isRevealed ? t('mcp.card.hide') : t('mcp.card.reveal')}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              )}

              <CardFooter className="flex flex-wrap gap-2 p-4 pt-2">
                {!status?.installed && (
                  <Button
                    size="sm"
                    onClick={() => void handleInstall(def.id)}
                    disabled={isBusy || !allFilled}
                  >
                    {isBusy ? t('mcp.card.installing') : t('mcp.card.connect')}
                  </Button>
                )}
                {status?.installed && !isEditing && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditForm(def.id, status.env)}
                      disabled={isBusy}
                    >
                      {t('mcp.card.editTokens')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleUninstall(def.id)}
                      disabled={isBusy}
                      className="border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                    >
                      {isBusy ? t('mcp.card.removing') : t('mcp.card.remove')}
                    </Button>
                  </>
                )}
                {status?.installed && isEditing && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => void handleInstall(def.id)}
                      disabled={isBusy || !allFilled}
                    >
                      {isBusy ? t('mcp.card.installing') : t('mcp.card.connect')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing((prev) => ({ ...prev, [def.id]: false }))}
                      disabled={isBusy}
                    >
                      {t('common.cancel')}
                    </Button>
                  </>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
