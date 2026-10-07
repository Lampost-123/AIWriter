// Settings › Models: check and repair's switch (Adam, 2026-10-07: "an off switch"), on by default. Off, new words are
// not checked as they land (no call), and the check after a draft looks at everything, as before.
import { useId } from 'react'
import { SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

export function RepairSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.checkNewWords ?? true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Checking new words">
      <div className="flex max-w-md items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void update({ checkNewWords: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Check new words straight away
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            After a draft, beat or Continue, fix small slips in amber and ask about the rest. Uses the memory model once each time.
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
