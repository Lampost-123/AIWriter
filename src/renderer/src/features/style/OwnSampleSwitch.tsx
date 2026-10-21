import { useId } from 'react'
import type { WritingPrefs } from '@shared/types'
import { OWN_SAMPLE_HINT, OWN_SAMPLE_LABEL, OWN_SAMPLE_OVER_HINT, ownSampleOn, ownSamplePref } from '@shared/ownSample'
import { Switch, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { usePrefs } from './prefsStore'

/**
 * Adam's preference "Use my own writing as the sample" (shared/ownSample.ts): passages he wrote himself take the place
 * of the sample passage. On while the sample passage is empty unless he turns it off; under a sample passage with words
 * in it, off unless he turns it on. The same switch is in Settings › My writing preferences.
 */
export function OwnSampleRow({ checked, onChange, hint = OWN_SAMPLE_HINT }: { checked: boolean; onChange: (on: boolean) => void; hint?: string }): React.JSX.Element {
  const ids = { input: useId(), hint: useId() }
  return (
    <div className="flex items-start gap-3">
      <Switch id={ids.input} checked={checked} onChange={onChange} aria-describedby={ids.hint} className="mt-px" />
      <div className="min-w-0">
        <label htmlFor={ids.input} className="text-[13px] font-medium text-fg">
          {OWN_SAMPLE_LABEL}
        </label>
        <p id={ids.hint} className="mt-0.5 text-[12px] leading-relaxed text-faint">
          {hint}
        </p>
      </div>
    </div>
  )
}

/** The switch under the sample passage on the Style guide screen (`sample`: the sample passage in effect there). */
export function OwnSampleSwitch({ sample }: { sample: string }): React.JSX.Element | null {
  const prefs = usePrefs((s) => s.prefs)
  if (!prefs) return null
  const filled = !!sample.trim()
  return (
    <OwnSampleRow
      checked={ownSampleOn(prefs.ownSample, sample)}
      hint={filled ? OWN_SAMPLE_OVER_HINT : OWN_SAMPLE_HINT}
      onChange={(on) => void setOwnSample(ownSamplePref(on, sample))}
    />
  )
}

// The preferences last known to be saved, and how many saves from this switch are on their way, so a failed save puts
// back what is really saved, not an earlier flip that hasn't been (or never will be).
let confirmed: WritingPrefs | null = null
let pending = 0

async function setOwnSample(value: WritingPrefs['ownSample']): Promise<void> {
  const now = usePrefs.getState().prefs
  if (!now) return
  if (!pending || !confirmed) confirmed = now
  const { ownSample: _old, ...rest } = now
  const next: WritingPrefs = value === undefined ? rest : { ...rest, ownSample: value }
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
