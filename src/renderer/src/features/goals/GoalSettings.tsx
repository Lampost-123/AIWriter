import { useEffect, useState } from 'react'
import { Field, Input, SettingsSection, toast } from '@/components/ui'
import { useApp } from '@/lib/store'
import { parseTarget } from './goalLogic'

/** Settings › Editor: the daily word target (empty for none). Saved as it is typed. */
export function GoalSettings(): React.JSX.Element | null {
  const daily = useApp((s) => s.settings?.goals?.daily ?? null)
  const ready = useApp((s) => !!s.settings)
  const [text, setText] = useState(daily ? String(daily) : '')
  // Changed somewhere else meanwhile: show it, unless it is what is typed here.
  useEffect(() => {
    setText((t) => (parseTarget(t) === daily ? t : daily ? String(daily) : ''))
  }, [daily])
  if (!ready) return null
  const save = (value: string): void => {
    setText(value)
    const next = parseTarget(value)
    if (next === daily) return
    useApp
      .getState()
      .updateSettings({ goals: { daily: next } })
      .catch((e: Error) => toast(`That change couldn't be saved. ${e.message}`, { tone: 'danger' }))
  }
  return (
    <SettingsSection
      title="Daily word target"
      description="Words to aim for each day, counting what you type yourself. Click the word count at the top of the page to see how today is going."
    >
      <Field label="Words a day" hint="Leave it empty for no target (and no streak).">
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            placeholder="No target"
            value={text}
            onChange={(e) => save(e.target.value.replace(/[^\d,]/g, ''))}
            className="max-w-[160px] tabular-nums"
          />
        )}
      </Field>
    </SettingsSection>
  )
}
