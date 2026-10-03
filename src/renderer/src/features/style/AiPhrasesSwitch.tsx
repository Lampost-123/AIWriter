import { useId } from 'react'
import type { WritingPrefs } from '@shared/types'
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
  return <AiPhrasesRow checked={prefs.avoidAiPhrases !== false} onChange={(on) => void setAvoidAiPhrases(on)} />
}

// The preferences last known to be saved, and how many saves from this switch are on their way, so a failed
// save puts back what is really saved, not an earlier toggle that hasn't been (or never will be).
let confirmed: WritingPrefs | null = null
let pending = 0

async function setAvoidAiPhrases(on: boolean): Promise<void> {
  const now = usePrefs.getState().prefs
  if (!now) return
  if (!pending || !confirmed) confirmed = now
  const next = { ...now, avoidAiPhrases: on }
  usePrefs.getState().saved(next)
  pending++
  try {
    await api.setWritingPrefs(next)
    confirmed = next
  } catch (e) {
    // Put the switch back unless something else changed the preferences meanwhile.
    if (usePrefs.getState().prefs === next) usePrefs.getState().saved(confirmed ?? now)
    toast(`Couldn't save that. ${(e as Error).message}`, { tone: 'danger' })
  } finally {
    pending--
  }
}
