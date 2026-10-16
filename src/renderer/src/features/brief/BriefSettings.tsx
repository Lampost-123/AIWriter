// Settings › Models: write a continuity brief before each scene (long story memory fix 14), on by default, beside the
// scene contract. The plan before writing also reads the whole story record (and the book so far when the memory model
// reads enough) and gives the writer a short brief of what matters for the scene; off, the plan's call and the briefing
// are as they were (src/main/ai/brief.ts, src/main/plan/brief.ts). It is written by the plan's call, so it needs Plan
// before writing.
import { useId } from 'react'
import { SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

export function BriefSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.continuityBrief ?? true)
  const planning = useApp((s) => s.settings?.planFirst ?? true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Continuity brief">
      <div className="flex max-w-md items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void update({ continuityBrief: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Write a continuity brief before each scene
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            While it plans, the memory model reads the whole story record (and the book so far, when it can) and tells the
            writer what matters for the scene. A bigger read: usually under a cent a scene on DeepSeek.
            {planning ? '' : ' It needs Plan before writing, which is off.'}
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
