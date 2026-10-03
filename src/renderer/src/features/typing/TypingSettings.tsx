/** Settings › Editor: Smart punctuation and typewriter scrolling. Each switch works at once, in the open page too. */
import { useId } from 'react'
import { SettingsSection } from '@/components/ui'
import { shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

export function TypingSettings(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  if (!settings) return null
  const ed = settings.editor
  return (
    <SettingsSection title="Typing">
      <div className="flex flex-col gap-3">
        <SwitchRow
          label="Smart punctuation"
          description={`Curly quotes, dashes and ellipses as you type. ${shortcutText('undo')} straight after puts back what you typed.`}
          checked={ed.smartPunctuation}
          onChange={(v) => void update({ editor: { smartPunctuation: v } })}
        />
        <SwitchRow
          label="Typewriter scrolling"
          description="Keeps the line you’re typing at the same height on the screen."
          checked={ed.typewriter}
          onChange={(v) => void update({ editor: { typewriter: v } })}
        />
      </div>
    </SettingsSection>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
      <Switch id={id} checked={checked} onChange={onChange} aria-describedby={`${id}-help`} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}
        </label>
        <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          {description}
        </p>
      </div>
    </div>
  )
}
