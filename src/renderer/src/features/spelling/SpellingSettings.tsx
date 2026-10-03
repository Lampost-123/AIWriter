import { useId } from 'react'
import { SettingsSection, toast } from '@/components/ui'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

/** Settings › Editor: Spell check on or off (straight away, no restart). */
export function SpellingSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.editor?.spellCheck !== false)
  const ready = useApp((s) => !!s.settings)
  const id = useId()
  if (!ready) return null
  const turn = (spellCheck: boolean): void => {
    useApp
      .getState()
      .updateSettings({ editor: { spellCheck } })
      .catch((e: Error) => toast(`That change couldn't be saved. ${e.message}`, { tone: 'danger' }))
  }
  return (
    <SettingsSection title="Spelling">
      <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={turn} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-[13px] font-medium text-fg">
            Check spelling as I type
          </label>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Underlines words that look misspelt, in UK or US spelling as your writing preferences and the style guide
            say. The names in your world count as correct. Right-click a word for suggestions and synonyms.
          </p>
        </div>
      </div>
    </SettingsSection>
  )
}
