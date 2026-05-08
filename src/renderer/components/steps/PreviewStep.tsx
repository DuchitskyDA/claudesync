import React, { useEffect, useState } from 'react'
import type { ScanResult } from '@shared/api'
import { AlertTriangle, Check, X } from 'lucide-react'
import { Button } from '../ui/button'
import { useT } from '../../i18n'

type Props = {
  onBack: () => void
  onConfirm: () => void
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export function PreviewStep({ onBack, onConfirm }: Props) {
  const t = useT()
  const [scan, setScan] = useState<ScanResult | null>(null)

  useEffect(() => {
    void window.api.scanLocalConfig().then(setScan)
  }, [])

  if (!scan) return <div className="p-4 text-sm text-muted-foreground">{t('init.preview.scanning')}</div>

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          {t('init.preview.includeTitle')} ({scan.files.length}, {formatBytes(scan.totalSize)})
        </h3>
        <div className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
          {scan.files.map((f) => (
            <div key={f} className="flex items-center gap-1">
              <Check className="h-3 w-3 text-emerald-500" />
              {f}
            </div>
          ))}
        </div>
      </div>

      {scan.excluded.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            {t('init.preview.excludeTitle')} ({scan.excluded.length})
          </h3>
          <div className="max-h-32 overflow-auto rounded-md border p-2 font-mono text-xs text-muted-foreground">
            {scan.excluded.map((f) => (
              <div key={f} className="flex items-center gap-1">
                <X className="h-3 w-3" />
                {f}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{t('init.preview.envWarning')}</span>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>{t('init.nav.back')}</Button>
        <Button onClick={onConfirm}>{t('init.preview.confirm')}</Button>
      </div>
    </div>
  )
}
