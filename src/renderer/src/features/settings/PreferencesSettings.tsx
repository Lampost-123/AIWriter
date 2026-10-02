import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Spelling, WritingPrefs } from '@shared/types'
import { Button, Field, Notice, Select, Spinner } from '@/components/ui'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { api } from '@/lib/api'
import { usePrefs } from '@/features/style/prefsStore'
import { ChipListInput } from '@/features/world/parts/ChipListInput'
import { createDraftCache } from '@/features/world/parts/draftCache'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { POV_PRESETS, PresetInput, TENSE_PRESETS } from '@/features/world/parts/TextInputs'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { useSlow } from '@/features/world/parts/useSlow'

const SPELLING_OPTIONS = [
  { value: 'UK', label: 'UK spelling', hint: 'colour, realise' },
  { value: 'US', label: 'US spelling', hint: 'color, realize' }
]

// The newest preferences until their write is confirmed, so re-opening this page
// straight after a change starts from what Adam typed.
const drafts = createDraftCache<WritingPrefs>()
const KEY = 'prefs'

/** Adam's own writing preferences, used in every world unless a world's style guide says otherwise. */
export function PreferencesSettings(): React.JSX.Element | null {
  const [loaded, setLoaded] = useState<WritingPrefs | null>(() => drafts.get(KEY) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const slow = useSlow(!loaded && !error)

  useEffect(() => {
    if (drafts.get(KEY)) return
    let live = true
    api
      .getWritingPrefs()
      .then((p) => {
        if (!live) return
        setLoaded(p)
        usePrefs.getState().saved(p)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [attempt])

  if (error && !loaded) {
    return (
      <Notice
        tone="danger"
        action={
          <Button
            size="sm"
            onClick={() => {
              setError(null)
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </Button>
        }
      >
        Couldn't load your writing preferences. {error}
      </Notice>
    )
  }
  if (!loaded) return slow ? <Spinner className="text-faint" /> : null
  return <PrefsForm initial={loaded} />
}

function PrefsForm({ initial }: { initial: WritingPrefs }): React.JSX.Element {
  const [prefs, setPrefs] = useState(initial)
  const ref = useRef(initial)
  const autosave = useAutosave<WritingPrefs>(
    async (p) => {
      const saved = await api.setWritingPrefs(p)
      drafts.confirm(KEY, p)
      // Keep what's on screen if Adam typed on while this was saving.
      usePrefs.getState().saved(ref.current === p ? saved : ref.current)
    },
    { what: 'your writing preferences' }
  )
  const { schedule } = autosave
  useEffect(() => {
    const d = drafts.get(KEY)
    if (d) schedule(d)
  }, [schedule])
  const update = useCallback(
    (patch: Partial<WritingPrefs>) => {
      const next = { ...ref.current, ...patch }
      ref.current = next
      setPrefs(next)
      drafts.set(KEY, next)
      schedule(next)
    },
    [schedule]
  )
  const ids = { avoid: useId(), avoidHint: useId() }

  return (
    <div className="flex max-w-lg flex-col gap-6" onBlur={() => void autosave.flush()}>
      <Field label="Spelling">
        {(id) => (
          <Select
            id={id}
            value={prefs.spelling}
            onChange={(v) => update({ spelling: (v ?? 'UK') as Spelling })}
            options={SPELLING_OPTIONS}
            className="max-w-[320px]"
          />
        )}
      </Field>
      <Field label="Point of view" hint="Who tells the story and how close the telling sits to them.">
        {(id) => <PresetInput id={id} value={prefs.pov} presets={POV_PRESETS} placeholder="Close third person" onChange={(pov) => update({ pov })} />}
      </Field>
      <Field label="Tense">
        {(id) => <PresetInput id={id} value={prefs.tense} presets={TENSE_PRESETS} placeholder="Past tense" onChange={(tense) => update({ tense })} />}
      </Field>
      <Field label="Voice notes" hint="How you like your prose to sound, in any world.">
        {(id) => (
          <AutoTextarea
            id={id}
            value={prefs.voiceNotes}
            minRows={3}
            maxRows={14}
            placeholder="Dry humour. Short sentences when things get tense. Let silences sit."
            onChange={(e) => update({ voiceNotes: e.target.value })}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.avoid} className="text-[12px] font-medium text-muted">
          Words to avoid
        </label>
        <ChipListInput
          id={ids.avoid}
          aria-describedby={ids.avoidHint}
          value={prefs.avoidWords}
          onChange={(avoidWords) => update({ avoidWords })}
          placeholder="Type a word or phrase and press Enter"
        />
        <p id={ids.avoidHint} className="text-[12px] text-faint">
          The AI is told never to use these, in every world.
        </p>
      </div>
      <div className="flex items-center gap-3 border-t border-line pt-4 text-[12px] text-faint">
        <span className="flex-1">Changes save as you type. A world's style guide can choose its own point of view, tense, spelling and notes. Words to avoid here apply in every world.</span>
        <SaveNote status={autosave.status} error={autosave.error} />
      </div>
    </div>
  )
}
