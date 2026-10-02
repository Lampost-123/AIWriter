import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { emptySceneCard } from '@shared/defaults'
import type { Entry, ID, SceneCard } from '@shared/types'
import { Button, Field, Input, Notice, Select, Spinner, toast } from '@/components/ui'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { api } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { placeOptions, type PlaceOption } from '@/features/world/entryLogic'
import { createDraftCache } from '@/features/world/parts/draftCache'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { useSlow } from '@/features/world/parts/useSlow'
import { beatsToStore } from './beats'
import { BeatsEditor } from './BeatsEditor'
import { CastPicker } from './CastPicker'

const LENGTH_PRESETS = [800, 1500, 2500, 4000]

// The newest card for each scene until its write is confirmed, so a panel that
// re-opens before then (switching tab or scene and straight back) starts from
// what Adam typed, never from the older copy on disk.
const cardDrafts = createDraftCache<SceneCard>()
// After a backup is restored these copies are from the world before it: never write them back.
registerDiscarder(() => cardDrafts.clear())

/**
 * The scene card in the right-hand panel: who is in the scene, where and when,
 * the beats, and how it should read. The AI drafts from this card. It saves as
 * Adam types, and straight away when he switches scene (the panel is keyed by scene).
 */
export function SceneCardPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  // Keyed here as well, so a change still waiting to save can never be written to the next scene.
  return <SceneCardForm key={sceneId} sceneId={sceneId} />
}

function SceneCardForm({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const entriesRev = useApp((s) => s.entriesRev)
  const [card, setCard] = useState<SceneCard | null>(() => cardDrafts.get(sceneId) ?? null)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const cardRef = useRef<SceneCard | null>(card)

  const autosave = useAutosave<SceneCard>(
    async (c) => {
      await api.updateSceneCard(sceneId, { ...c, beats: beatsToStore(c.beats) })
      cardDrafts.confirm(sceneId, c)
    },
    { what: 'the scene card' }
  )
  const { schedule } = autosave

  // Opened from a copy that isn't confirmed saved yet: queue it again, so it is
  // written even if the earlier panel's write never landed.
  useEffect(() => {
    const draft = cardDrafts.get(sceneId)
    if (draft) schedule(draft)
  }, [sceneId, schedule])

  useEffect(() => {
    if (cardRef.current) return
    let live = true
    api
      .getScene(sceneId)
      .then((s) => {
        if (!live) return
        const c = { ...emptySceneCard(), ...s.card }
        cardRef.current = c
        setCard(c)
        setError(null)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [sceneId, attempt])

  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(list.filter((e) => e.kind === 'character' || e.kind === 'place')))
      .catch(() => live && setEntries((prev) => prev ?? []))
    return () => {
      live = false
    }
  }, [entriesRev])

  const update = useCallback(
    (patch: Partial<SceneCard>) => {
      if (!cardRef.current) return
      const next = { ...cardRef.current, ...patch }
      cardRef.current = next
      setCard(next)
      cardDrafts.set(sceneId, next)
      schedule(next)
    },
    [schedule, sceneId]
  )
  // Stable callbacks and memoised lists, so typing in one field doesn't redraw the
  // pickers (which hold every character and place in the world).
  const onBeats = useCallback((beats: string[]) => update({ beats }), [update])
  const setPov = useCallback((povId: ID | null) => update({ povId }), [update])
  const setLocation = useCallback((locationId: ID | null) => update({ locationId }), [update])
  const setPresent = useCallback((presentIds: ID[]) => update({ presentIds }), [update])
  const characters = useMemo(() => (entries ?? []).filter((e) => e.kind === 'character'), [entries])
  const places = useMemo(() => (entries ?? []).filter((e) => e.kind === 'place'), [entries])
  const povOptions = useMemo(() => characters.map((c) => ({ value: c.id, label: c.name.trim() || 'Unnamed' })), [characters])
  const locOptions = useMemo(() => placeOptions(places), [places])

  const createCharacter = useCallback(async (name: string): Promise<Entry | null> => {
    try {
      const e = await api.createEntry('character', { name })
      setEntries((prev) => [...(prev ?? []), e])
      useApp.getState().bumpEntries()
      toast(`Added ${e.name} to your characters. Fill in their profile under Characters when you're ready.`)
      return e
    } catch (err) {
      toast(`Couldn't add ${name}. ${(err as Error).message}`, { tone: 'danger' })
      return null
    }
  }, [])

  const ids = { pov: useId(), cast: useId(), castHint: useId(), loc: useId(), beats: useId(), beatsHint: useId() }
  const slow = useSlow(!card && !error)

  if (error && !card) {
    return (
      <div className="p-4">
        <Notice
          tone="danger"
          action={
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          Couldn't load this scene's card. {error}
        </Notice>
      </div>
    )
  }
  if (!card || !entries) {
    return slow ? (
      <div className="flex justify-center py-10 text-faint">
        <Spinner />
      </div>
    ) : (
      <div />
    )
  }

  const povValue = card.povId && characters.some((c) => c.id === card.povId) ? card.povId : null
  const locValue = card.locationId && places.some((p) => p.id === card.locationId) ? card.locationId : null

  return (
    <div className="flex animate-fade-in flex-col gap-5 px-4 pb-12 pt-4" onBlur={() => void autosave.flush()}>
      <Group title="Who and where" action={<SaveNote status={autosave.status} error={autosave.error} />}>
        <Field label="Point of view" hint={characters.length ? 'The scene is told through their eyes.' : 'No characters yet. Type a name under Characters present to add one.'}>
          {(id) => <OptionSelect id={id} value={povValue} onChange={setPov} options={povOptions} />}
        </Field>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.cast} className="text-[12px] font-medium text-muted">
            Characters present
          </label>
          <CastPicker
            id={ids.cast}
            aria-describedby={ids.castHint}
            value={card.presentIds}
            povId={povValue}
            characters={characters}
            onChange={setPresent}
            onCreate={createCharacter}
          />
          <p id={ids.castHint} className="text-[12px] text-faint">
            Characters named here are given to the AI with their full profile.
          </p>
        </div>
        <Field label="Location" hint={places.length ? undefined : 'No places yet. Add one under Places.'}>
          {(id) => <OptionSelect id={id} value={locValue} onChange={setLocation} options={locOptions} />}
        </Field>
        <Field label="When" hint="In-world date and time, in your own words.">
          {(id) => <Input id={id} value={card.when} placeholder="Day 12, Year 3, at dusk" onChange={(e) => update({ when: e.target.value })} />}
        </Field>
      </Group>

      <Group title="What happens">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.beats} className="text-[12px] font-medium text-muted">
            Beats
          </label>
          <p id={ids.beatsHint} className="-mt-0.5 mb-0.5 text-[12px] text-faint">
            The 3 to 8 things that must happen, in order
          </p>
          <BeatsEditor id={ids.beats} aria-describedby={ids.beatsHint} initial={card.beats} onChange={onBeats} />
        </div>
        <Field label="Goal">
          {(id) => <AutoTextarea id={id} value={card.goal} minRows={1} maxRows={10} placeholder="What they're trying to do" onChange={(e) => update({ goal: e.target.value })} />}
        </Field>
        <Field label="Conflict">
          {(id) => <AutoTextarea id={id} value={card.conflict} minRows={1} maxRows={10} placeholder="What stands in their way" onChange={(e) => update({ conflict: e.target.value })} />}
        </Field>
        <Field label="Outcome">
          {(id) => <AutoTextarea id={id} value={card.outcome} minRows={1} maxRows={10} placeholder="How it ends, and what changes" onChange={(e) => update({ outcome: e.target.value })} />}
        </Field>
      </Group>

      <Group title="How it reads">
        <Field label="Mood or tone">
          {(id) => <Input id={id} value={card.mood} placeholder="Quiet and tense, with a bitter edge" onChange={(e) => update({ mood: e.target.value })} />}
        </Field>
        <Field label="Target length">{(id) => <TargetLength id={id} value={card.targetWords} onChange={(targetWords) => update({ targetWords })} />}</Field>
        <Field label="Notes for the AI" hint="Names you mention in the beats and notes are looked up in your world too.">
          {(id) => (
            <AutoTextarea
              id={id}
              value={card.notes}
              minRows={3}
              maxRows={16}
              placeholder="Anything else to keep in mind, like a callback to an earlier scene"
              onChange={(e) => update({ notes: e.target.value })}
            />
          )}
        </Field>
      </Group>
    </div>
  )
}

const OptionSelect = memo(function OptionSelect({
  id,
  value,
  onChange,
  options
}: {
  id: string
  value: ID | null
  onChange: (v: ID | null) => void
  options: PlaceOption[]
}): React.JSX.Element {
  return <Select id={id} value={value} onChange={onChange} options={options} allowNone noneLabel="None" placeholder="None" />
})

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3.5 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex h-5 items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function TargetLength({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const set = (n: number): void => {
    setText(String(n))
    onChange(n)
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={100}
          max={20000}
          step={100}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const n = Math.round(Number(e.target.value))
            if (Number.isFinite(n) && n >= 100 && n <= 20000) onChange(n)
          }}
          onBlur={() => setText(String(value))}
          className="w-[76px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-[13px] text-muted">words</span>
      </div>
      <div className="flex gap-1" role="group" aria-label="Quick lengths">
        {LENGTH_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={value === p}
            onClick={() => set(p)}
            className={cn(
              'h-6 rounded-full border px-2 text-[12px] tabular-nums transition-colors duration-150',
              value === p ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg'
            )}
          >
            {p.toLocaleString('en-GB')}
          </button>
        ))}
      </div>
    </div>
  )
}
