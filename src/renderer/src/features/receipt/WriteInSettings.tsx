// Settings › Models: Write in what a draft missed (2026-10-19; autoWriteIn.ts), off by default. On, when the receipt over
// the AI dock shows something Adam asked for that the draft left out, the app writes it in once by itself, as Write it in
// does: a Continue from the end of the scene, waiting below for him to keep or not.
import { useId } from 'react'
import { SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

export function WriteInSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.autoWriteIn === true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="What a draft missed">
      <div className="flex max-w-md items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void update({ autoWriteIn: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Write in what a draft missed
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            When a draft leaves out something you asked for, the AI writes it in once by itself, the way Write it in does: a
            short continuation at the end of the scene, which you keep or not. Never for a length you asked for. Costs one
            short continuation when it happens.
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
