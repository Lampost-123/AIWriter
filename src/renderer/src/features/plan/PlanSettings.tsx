// Settings › Models: plan before writing (step 4 of the consistency plan, Adam 2026-10-07), on by default. Off, a draft
// makes no plan call (src/main/plan/); what must stay true still goes in.
import { useId } from 'react'
import { SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

export function PlanSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.planFirst ?? true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Planning">
      <div className="flex max-w-md items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void update({ planFirst: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Plan before writing
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Before Generate, Add below or a beat, the memory model plans what the scene keeps to and what changes. One short call
            each time; Low Thinking on the memory model plans better.
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
