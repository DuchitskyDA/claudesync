import React, { useState } from 'react'
import type { PluginEnvRequirement } from '@shared/api'
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
import { useT } from '../i18n'

type Props = {
  pluginName: string
  requirement: PluginEnvRequirement
  onSkip: () => void
  onSave: (value: string) => void
}

export function EnvPromptModal({ pluginName, requirement, onSkip, onSave }: Props) {
  const t = useT()
  const [value, setValue] = useState('')
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onSkip() }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('envPrompt.title', { pluginName })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {requirement.instructions}
          </p>
          {requirement.docsUrl && (
            <a
              href={requirement.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-primary hover:underline"
            >
              {t('envPrompt.openDocs', { url: requirement.docsUrl })}
            </a>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="env-value">{requirement.label}</Label>
            <Input
              id="env-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={requirement.placeholder}
              className="font-mono"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onSkip}>{t('envPrompt.skip')}</Button>
          <Button onClick={() => onSave(value)} disabled={value.trim() === ''}>
            {t('envPrompt.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
