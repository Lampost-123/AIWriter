// Settings › Models: give each scene a contract (long story memory fix 13), on by default. Off, a draft's briefing has
// no contract, the plan doesn't say what must change, and the check of new words is as it was (src/main/ai/contract.ts).
import { useId } from 'react'
import { SettingsSection, Switch } from '@/components/ui'
import { useApp } from '@/lib/store'

export function ContractSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.sceneContracts ?? true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Scene contracts">
      <div className="flex max-w-md items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void update({ sceneContracts: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Give each scene a contract
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Each draft gets a short list of what must be true at the start, what must change and what must not, and is checked
            against it. The AI reads a little more each time.
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
