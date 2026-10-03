import { useId } from 'react'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { Switch } from '@/features/world/parts/Switch'
import { usePrefs } from './prefsStore'

export const AI_PHRASES_LABEL = 'Steer clear of common AI phrases'
export const AI_PHRASES_HINT =
  'Tells the AI to avoid worn phrases that make writing sound machine-made. Applies in every world, and drafts get an underline on any that slip through.'

/**
 * Adam's preference "Steer clear of common AI phrases" (on unless he turns it off). The same switch is in
 * Settings › My writing preferences; `checked` and `onChange` come from wherever it sits.
 */
export function AiPhrasesRow({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }): React.JSX.Element {
  const ids = { input: useId(), hint: useId() }
  return (
    <div className="flex items-start gap-3">
      <Switch id={ids.input} checked={checked} onChange={onChange} aria-describedby={ids.hint} className="mt-px" />
      <div className="min-w-0">
        <label htmlFor={ids.input} className="text-[13px] font-medium text-fg">
          {AI_PHRASES_LABEL}
        </label>
        <p id={ids.hint} className="mt-0.5 text-[12px] leading-relaxed text-faint">
          {AI_PHRASES_HINT}
        </p>
      </div>
    </div>
  )
}

/** The switch on the Style guide screen: saves Adam's preference straight away. */
export function AiPhrasesSwitch(): React.JSX.Element | null {
  const prefs = usePrefs((s) => s.prefs)
  if (!prefs) return null
  const set = async (on: boolean): Promise<void> => {
    const before = usePrefs.getState().prefs
    if (!before) return
    const next = { ...before, avoidAiPhrases: on }
    usePrefs.getState().saved(next)
    try {
      await api.setWritingPrefs(next)
    } catch (e) {
      // Put the switch back unless something else changed the preferences meanwhile.
      if (usePrefs.getState().prefs === next) usePrefs.getState().saved(before)
      toast(`Couldn't save that. ${(e as Error).message}`, { tone: 'danger' })
    }
  }
  return <AiPhrasesRow checked={prefs.avoidAiPhrases !== false} onChange={(on) => void set(on)} />
}
