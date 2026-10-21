// Settings › Models: plan before writing (step 4 of the consistency plan, Adam 2026-10-07), on by default. Off, a draft
// makes no plan call (src/main/plan/); what must stay true still goes in. Beside it, Show me the plan before writing (off by
// default; src/main/plan/review.ts): Generate and Add below stop once the scene is planned, to show Adam the plan.
import { useId } from 'react'
import { SettingsSection, Switch } from '@/components/ui'
import { useApp } from '@/lib/store'

export function PlanSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.planFirst ?? true)
  const showFirst = useApp((s) => s.settings?.showPlanFirst === true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  const showId = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Planning">
      <div className="flex max-w-md flex-col gap-2">
        <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
          <Switch id={id} checked={on} onChange={(v) => void update({ planFirst: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <label htmlFor={id} className="text-[13px] font-medium text-fg">
              Plan before writing
            </label>
            <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              Before Generate, Add below or a beat, the memory model plans what the scene keeps to and what changes. Uses the
              memory model once each time.
            </p>
          </div>
        </div>
        <div className={`flex items-start gap-3 rounded-lg border border-line px-3 py-2.5 ${on ? '' : 'opacity-60'}`}>
          <Switch id={showId} checked={showFirst} onChange={(v) => void update({ showPlanFirst: v })} aria-describedby={`${showId}-help`} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <label htmlFor={showId} className="text-[13px] font-medium text-fg">
              Show me the plan before writing
            </label>
            <p id={`${showId}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              Generate and Add below stop once the scene is planned and show you the plan: what happens beat by beat, who is
              where, what changes and how it ends. Change any of it, then write, or cancel. No extra cost: the plan is made
              anyway. You can also turn it on for one draft in the draft options.
              {on ? '' : ' It needs Plan before writing, which is off.'}
            </p>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
