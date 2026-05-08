import React, { useEffect, useState } from 'react'
import type { ScanResult } from '@shared/api'

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
  const [scan, setScan] = useState<ScanResult | null>(null)

  useEffect(() => {
    void window.api.scanLocalConfig().then(setScan)
  }, [])

  if (!scan) return <div className="p-4 text-sm text-neutral-500">Scanning config…</div>

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Files to upload ({scan.files.length}, {formatBytes(scan.totalSize)})
        </h3>
        <div className="max-h-48 overflow-auto rounded border border-neutral-200 bg-neutral-50 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900">
          {scan.files.map((f) => (
            <div key={f}>✓ {f}</div>
          ))}
        </div>
      </div>

      {scan.excluded.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Excluded ({scan.excluded.length})</h3>
          <div className="max-h-32 overflow-auto rounded border border-neutral-200 p-2 font-mono text-xs text-neutral-500 dark:border-neutral-700">
            {scan.excluded.map((f) => (
              <div key={f}>✗ {f}</div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        ⚠ env block in settings.json will be stripped from the upload. Re-add API keys via Plugin manager after pull on other machines.
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
        >
          Create &amp; Push
        </button>
      </div>
    </div>
  )
}
