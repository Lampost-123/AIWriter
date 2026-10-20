// Settings › Models: Directed writing (Adam's spec, "Directed writing (an option)"), off by default. On, Generate, Add
// below and Write the chapter's drafts are written a stretch at a time with the director's notes between
// (src/main/director). The draft options can turn it on or off for one draft. The director's own model is its own entry
// above ("Director model", the memory model unless Adam picks another).
import { useId } from 'react'
import { SettingsSection } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

export function DirectorSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.directedWriting === true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Directed writing">
      <div className="flex max-w-md items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void update({ directedWriting: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Direct every draft
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Generate, Add below and Write the chapter write a stretch at a time. Between stretches a director reads what was
            written, checks it against the plan and the story, and gives the writer a short note, or has it write the last
            paragraph again. You can add your own notes while it writes. It never writes the story itself.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-faint">
            Costs a little more and takes a little longer: the writer reads the scene’s briefing again for each stretch
            (mostly from the provider’s cache), and the director model is asked only when something needs a look. You can
            also turn it on for one draft in the draft options.
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
