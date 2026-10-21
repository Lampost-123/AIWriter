import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Spelling, WritingPrefs } from '@shared/types'
import { Button, Field, Notice, Select, SettingsSection, Spinner } from '@/components/ui'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { api } from '@/lib/api'
import { AiPhrasesRow } from '@/features/style/AiPhrasesSwitch'
import { OwnSampleRow } from '@/features/style/OwnSampleSwitch'
import { usePrefs } from '@/features/style/prefsStore'
import { ChipListInput } from '@/features/world/parts/ChipListInput'
import { createDraftCache } from '@/features/world/parts/draftCache'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { POV_PRESETS, PresetInput, TENSE_PRESETS } from '@/features/world/parts/TextInputs'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { useSlow } from '@/features/world/parts/useSlow'
import { WordTargetInput } from '@/features/inspector/WordTargetInput'
import { CHAPTER_TARGET_LIMITS, SCENE_LENGTH_LIMITS } from '@shared/lengths'

const SPELLING_OPTIONS = [
  { value: 'UK', label: 'UK spelling', hint: 'colour, realise' },
  { value: 'US', label: 'US spelling', hint: 'color, realize' }
]

/** The page's three cards; the "Saved" note shows on the one last changed. */
type Group = 'basics' | 'sound' | 'lengths'

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
  const [group, setGroup] = useState<Group | null>(null)
  const update = useCallback(
    (patch: Partial<WritingPrefs>, from: Group) => {
      setGroup(from)
      const next = { ...ref.current, ...patch }
      ref.current = next
      setPrefs(next)
      drafts.set(KEY, next)
      schedule(next)
    },
    [schedule]
  )
  const ids = { avoid: useId(), avoidHint: useId() }
  const note = (g: Group): React.JSX.Element | null =>
    group === g ? <SaveNote status={autosave.status} error={autosave.error} className="min-w-0 justify-start" /> : null

  return (
    <div className="flex flex-col gap-6" onBlur={() => void autosave.flush()}>
      <SettingsSection
        title="Spelling, point of view and tense"
        description="How every story is told, unless a world's style guide says otherwise."
        badge={note('basics')}
      >
        <div className="flex max-w-[560px] flex-col gap-5">
          <Field label="Spelling">
            {(id) => (
              <Select
                id={id}
                value={prefs.spelling}
                onChange={(v) => update({ spelling: (v ?? 'UK') as Spelling }, 'basics')}
                options={SPELLING_OPTIONS}
                className="max-w-[320px]"
              />
            )}
          </Field>
          <Field label="Point of view" hint="Who tells the story and how close the telling sits to them.">
            {(id) => (
              <PresetInput
                id={id}
                value={prefs.pov}
                presets={POV_PRESETS}
                placeholder="Close third person"
                onChange={(pov) => update({ pov }, 'basics')}
              />
            )}
          </Field>
          <Field label="Tense">
            {(id) => (
              <PresetInput
                id={id}
                value={prefs.tense}
                presets={TENSE_PRESETS}
                placeholder="Past tense"
                onChange={(tense) => update({ tense }, 'basics')}
              />
            )}
          </Field>
        </div>
      </SettingsSection>
      <SettingsSection
        title="How it sounds"
        description="Your voice, and what the AI should never write, in every world."
        badge={note('sound')}
      >
        <div className="flex max-w-[560px] flex-col gap-5">
          <Field label="Voice notes" hint="How you like your prose to sound, in any world.">
            {(id) => (
              <AutoTextarea
                id={id}
                value={prefs.voiceNotes}
                minRows={3}
                maxRows={14}
                placeholder="Dry humour. Short sentences when things get tense. Let silences sit."
                onChange={(e) => update({ voiceNotes: e.target.value }, 'sound')}
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
              onChange={(avoidWords) => update({ avoidWords }, 'sound')}
              placeholder="Type a word or phrase and press Enter"
            />
            <p id={ids.avoidHint} className="text-[12px] text-faint">
              The AI is told never to use these, in every world.
            </p>
          </div>
          <AiPhrasesRow checked={prefs.avoidAiPhrases !== false} onChange={(avoidAiPhrases) => update({ avoidAiPhrases }, 'sound')} />
          {/* On: while a sample passage is empty (left out); off: never. A style screen may turn it on over a sample passage. */}
          <OwnSampleRow checked={prefs.ownSample !== false} onChange={(on) => update({ ownSample: on ? undefined : false }, 'sound')} />
        </div>
      </SettingsSection>
      <SettingsSection
        title="Lengths"
        description="How long scenes and chapters aim to be, unless a card sets its own."
        badge={note('lengths')}
      >
        <div className="flex max-w-[560px] flex-col gap-5">
          <Field
            label="Scene length"
            hint="What a scene aims for when neither its card nor its chapter sets a length. Leave it empty to let the AI pick."
          >
            {(id) => (
              <WordTargetInput
                id={id}
                value={prefs.sceneLength ?? null}
                onChange={(sceneLength) => update({ sceneLength }, 'lengths')}
                limits={SCENE_LENGTH_LIMITS}
                placeholder="Auto"
              />
            )}
          </Field>
          <Field
            label="Chapter length"
            hint="A target for each whole chapter, unless its chapter card sets its own. The scenes on Auto share it out. Leave it empty for none."
          >
            {(id) => (
              <WordTargetInput
                id={id}
                value={prefs.chapterLength ?? null}
                onChange={(chapterLength) => update({ chapterLength }, 'lengths')}
                limits={CHAPTER_TARGET_LIMITS}
                placeholder="None"
              />
            )}
          </Field>
        </div>
      </SettingsSection>
      <p className="px-1 text-[12px] leading-relaxed text-faint">
        Changes save as you type. A world's style guide can choose its own point of view, tense, spelling and notes. Words to avoid and
        lengths here apply in every world.
        {group === null ? <SaveNote status={autosave.status} error={autosave.error} className="ml-2 min-w-0" /> : null}
      </p>
    </div>
  )
}
