import React from 'react'
import { FileText, Folder } from 'lucide-react'
import { Button } from '../ui/button'
import { useT } from '../../i18n'

type Props = {
  onBack: () => void
  onConfirm: () => void
}

type Entry = { kind: 'dir' | 'file'; path: string; hint?: string }

const SKELETON: Entry[] = [
  { kind: 'dir', path: 'claude/', hint: 'init.preview.hint.claude' },
  { kind: 'dir', path: 'cursor/projects/', hint: 'init.preview.hint.cursor' },
  { kind: 'file', path: 'install.sh', hint: 'init.preview.hint.installSh' },
  { kind: 'file', path: 'install.ps1', hint: 'init.preview.hint.installPs1' },
  { kind: 'file', path: 'README.md' },
  { kind: 'file', path: 'LICENSE' },
  { kind: 'file', path: '.gitignore' },
]

export function PreviewStep({ onBack, onConfirm }: Props) {
  const t = useT()

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-muted-foreground">{t('init.preview.description')}</p>

      <div className="min-w-0">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('init.preview.structureTitle')}
        </h3>
        <div className="min-w-0 rounded-md border bg-muted/40 p-3">
          <ul className="space-y-1.5 font-mono text-xs">
            {SKELETON.map((e) => (
              <li key={e.path} className="flex min-w-0 items-start gap-2">
                {e.kind === 'dir' ? (
                  <Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                ) : (
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="shrink-0 font-medium">{e.path}</span>
                {e.hint && (
                  <span
                    className="ml-2 block min-w-0 flex-1 truncate text-muted-foreground"
                    title={t(e.hint)}
                  >
                    — {t(e.hint)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t('init.preview.afterHint')}</p>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>{t('init.nav.back')}</Button>
        <Button onClick={onConfirm}>{t('init.preview.confirm')}</Button>
      </div>
    </div>
  )
}
