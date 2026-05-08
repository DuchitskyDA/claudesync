import React from 'react'
import { Tabs as UITabs, TabsList, TabsTrigger } from './ui/tabs'

type Props<T extends string> = {
  active: T
  onChange: (t: T) => void
  tabs: { id: T; label: string; disabled?: boolean; tooltip?: string }[]
}

export function Tabs<T extends string>({ active, onChange, tabs }: Props<T>) {
  return (
    <div className="border-b px-4 pt-3 pb-2">
      <UITabs value={active} onValueChange={(v) => onChange(v as T)}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} disabled={t.disabled} title={t.tooltip}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </UITabs>
    </div>
  )
}
