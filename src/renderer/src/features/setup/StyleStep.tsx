// The first run's fourth step (milestone 6): the basic style guide (point of view, tense, spelling and a sentence
// on how the prose should sound), kept as Adam's own writing preferences (Settings › My writing preferences), which
// every world's style guide sits on. Saves as he types, when he leaves the step, and before the window closes.

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { Spelling, WritingPrefs } from '@shared/types'
import { Field, Notice } from '@/components/ui'
import { api } from '@/lib/api'
import { registerFlusher } from '@/lib/flush'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { POV_PRESETS, PresetInput, TENSE_PRESETS } from '@/features/world/parts/TextInputs'
import { Segmented } from '@/features/generate/parts'
import { usePrefs } from '@/features/style/prefsStore'

export interface StyleSaver {
  /** Saves what is typed now (if anything changed). Never throws: a failure is said on the step. */
  save(): Promise<void>
}

const SPELLING: { value: Spelling; label: string }[] = [
  { value: 'UK', label: 'UK (colour)' },
  { value: 'US', label: 'US (color)' }
]

const QUIET_MS = 600

export function StyleStep({ saverRef }: { saverRef: Ref<StyleSaver | null> }): React.JSX.Element {
  const [prefs, setPrefs] = useState<WritingPrefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<WritingPrefs | null>(null)
  const saved = useRef<string>('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let live = true
    api
      .getWritingPrefs()
      .then((p) => {
        if (!live) return
        latest.current = p
        saved.current = JSON.stringify(p)
        setPrefs(p)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [])

  const save = useRef(async (): Promise<void> => {
    clearTimeout(timer.current)
    const p = latest.current
    if (!p || JSON.stringify(p) === saved.current) return
    try {
      const done = await api.setWritingPrefs(p)
      saved.current = JSON.stringify(p)
      usePrefs.getState().saved(done)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }).current

  useImperativeHandle(saverRef, () => ({ save }), [save])
  // Nothing typed is lost: saved before the window closes or the world changes, and when the step goes.
  useEffect(() => {
    const off = registerFlusher(save)
    return () => {
      off()
      void save()
    }
  }, [save])

  const update = (patch: Partial<WritingPrefs>): void => {
    if (!latest.current) return
    const next = { ...latest.current, ...patch }
    latest.current = next
    setPrefs(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), QUIET_MS)
  }

  if (!prefs)
    return error ? (
      <Notice tone="danger">Couldn’t load your writing preferences. {error}</Notice>
    ) : (
      <div className="min-h-[360px]" aria-busy />
    )

  return (
    <div className="flex flex-col gap-5">
      <Field label="Point of view" hint="Who tells the story, and how close the telling sits to them.">
        {(id) => (
          <PresetInput
            id={id}
            value={prefs.pov}
            presets={POV_PRESETS}
            placeholder="Close third person"
            onChange={(pov) => update({ pov })}
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
            onChange={(tense) => update({ tense })}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted">Spelling</span>
        <Segmented
          label="Spelling"
          value={prefs.spelling}
          onChange={(spelling) => update({ spelling })}
          options={SPELLING}
          className="w-[260px] *:flex-1"
        />
      </div>
      <Field label="How should the prose sound?" hint="A sentence or two, in your own words. You can say more in the style guide later.">
        {(id) => (
          <AutoTextarea
            id={id}
            value={prefs.voiceNotes}
            minRows={2}
            maxRows={8}
            placeholder="Plain and warm. Short sentences when things get tense. Let silences sit."
            onChange={(e) => update({ voiceNotes: e.target.value })}
          />
        )}
      </Field>
      {error ? <Notice tone="danger">Your style couldn’t be saved. {error}</Notice> : null}
    </div>
  )
}
