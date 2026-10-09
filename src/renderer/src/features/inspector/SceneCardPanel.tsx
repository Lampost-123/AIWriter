import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { cardLength, emptySceneCard } from '@shared/defaults'
import type { CarryField, ChapterCard, Entry, ID, SceneCard } from '@shared/types'
import { aiLinked, mergeThreadLinks, withListEdited, type ThreadList } from '@shared/threadLinks'
import { carryOf, emptyChapterCard, follows, isFieldEmpty, resolveCardWrite, followChapterPart, withCarry } from '@shared/chapterCard'
import { CarryRow } from '@/features/chapterCard/CarryRow'
import { Button, Field, Input, Notice, Select, Spinner, toast } from '@/components/ui'
import { Feather, ListOrdered, Spool, TextQuote, Users, type IconType } from '@/components/ui/icons'
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
import { BringAbout, SceneSummary } from './SceneMemory'
import { SceneIdeas } from '@/features/outline/SceneIdeas'
import { InterviewButton, PlanInterview, usePlanSession } from '@/features/outline/PlanInterview'
import { registerInterviewCard } from '@/features/outline/planInterviewStore'
import { registerPayOffPanel, takePayOff, undoPayOff } from '@/features/threads/payOff'

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
  const chapterCardsRev = useApp((s) => s.chapterCardsRev)
  const [card, setCard] = useState<SceneCard | null>(() => cardDrafts.get(sceneId) ?? null)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const cardRef = useRef<SceneCard | null>(card)
  // Chapter cards: the scene's chapter and its card, for "From chapter" and "Use chapter's".
  const [chapter, setChapter] = useState<{ id: ID; card: ChapterCard } | null>(null)
  const chapterRef = useRef(chapter)
  chapterRef.current = chapter
  /** A change to this card not yet written: a chapter card change then doesn't reload it (the write settles it). */
  const dirty = useRef(false)

  const autosave = useAutosave<SceneCard>(
    async (c) => {
      await api.updateSceneCard(sceneId, { ...c, beats: beatsToStore(c.beats) })
      if (cardRef.current === c) dirty.current = false
      cardDrafts.confirm(sceneId, c)
      // The briefing is built from the card: the Context tab shows the new one.
      useApp.getState().bumpBriefing()
    },
    { what: 'the scene card' }
  )
  const { schedule: scheduleSave } = autosave
  const schedule = useCallback(
    (c: SceneCard) => {
      dirty.current = true
      scheduleSave(c)
    },
    [scheduleSave]
  )

  // Opened from a copy that isn't confirmed saved yet: queue it again, so it is
  // written even if the earlier panel's write never landed.
  useEffect(() => {
    const draft = cardDrafts.get(sceneId)
    if (draft) schedule(draft)
  }, [sceneId, schedule])

  useEffect(() => {
    let live = true
    api
      .getScene(sceneId)
      .then(async (s) => {
        if (!live) return
        if (!cardRef.current) {
          const c = { ...emptySceneCard(), ...s.card }
          cardRef.current = c
          setCard(c)
          setError(null)
        }
        const chapterCard = await api.getChapterCard(s.chapterId).catch(() => emptyChapterCard())
        if (live) setChapter({ id: s.chapterId, card: chapterCard })
      })
      .catch((e: Error) => live && !cardRef.current && setError(e.message))
    return () => {
      live = false
    }
  }, [sceneId, attempt])

  // A chapter card changed what this card follows (its change, its Undo, a move to another chapter): the parts it
  // follows, and the chapter's card, are read again. A change of Adam's still being written settles it instead.
  const seenRev = useRef(chapterCardsRev)
  useEffect(() => {
    if (seenRev.current === chapterCardsRev) return
    seenRev.current = chapterCardsRev
    let live = true
    void (async () => {
      try {
        const s = await api.getScene(sceneId)
        const chapterCard = await api.getChapterCard(s.chapterId)
        if (!live) return
        setChapter({ id: s.chapterId, card: chapterCard })
        const now = cardRef.current
        if (!now || dirty.current) return
        const next = withCarry(now, carryOf({ ...emptySceneCard(), ...s.card }))
        if (JSON.stringify(next) === JSON.stringify(now)) return
        cardRef.current = next
        setCard(next)
      } catch {
        // The scene went; its panel goes with it.
      }
    })()
    return () => {
      live = false
    }
  }, [chapterCardsRev, sceneId])

  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(list))
      .catch(() => live && setEntries((prev) => prev ?? []))
    return () => {
      live = false
    }
  }, [entriesRev])

  const put = useCallback(
    (next: SceneCard) => {
      cardRef.current = next
      setCard(next)
      cardDrafts.set(sceneId, next)
      schedule(next)
    },
    [schedule, sceneId]
  )
  const update = useCallback(
    (patch: Partial<SceneCard>) => {
      const now = cardRef.current
      if (!now) return
      // A part that follows the chapter card and is changed here becomes the scene's own (as the save will decide).
      put(resolveCardWrite(now, { ...now, ...patch }, chapterRef.current?.card ?? emptyChapterCard()))
    },
    [put]
  )
  /** "Use chapter's": the part follows the chapter card again, with its value. */
  const followChapter = useCallback(
    (f: CarryField) => {
      const now = cardRef.current
      const ch = chapterRef.current
      if (!now || !ch) return
      put(followChapterPart(now, ch.card, f))
    },
    [put]
  )
  // Stable callbacks and memoised lists, so typing in one field doesn't redraw the
  // pickers (which hold every character and place in the world).
  const onBeats = useCallback((beats: string[]) => update({ beats }), [update])
  // Next scene ideas (milestone 4) fill the card in one click, beats too: the beats list starts again from them.
  const [beatsRev, setBeatsRev] = useState(0)
  const fillFromIdea = useCallback(
    (patch: Partial<SceneCard>) => {
      update(patch)
      if (patch.beats) setBeatsRev((n) => n + 1)
    },
    [update]
  )
  // Interview me: what it puts in the card shows here at once, and the card it reads is the one on screen.
  const interviewTarget = useMemo(() => ({ kind: 'scene' as const, sceneId }), [sceneId])
  const interview = usePlanSession(interviewTarget)
  useEffect(() => registerInterviewCard(sceneId, { current: () => cardRef.current, patch: fillFromIdea }), [sceneId, fillFromIdea])
  const setPov = useCallback((povId: ID | null) => update({ povId }), [update])
  const setLocation = useCallback((locationId: ID | null) => update({ locationId }), [update])
  const setPresent = useCallback((presentIds: ID[]) => update({ presentIds }), [update])
  // A plot thread link the AI made and Adam takes off is never put back by it; one he adds is his (shared/threadLinks.ts).
  const editThreads = useCallback(
    (list: ThreadList, ids: ID[]) => {
      if (!cardRef.current) return
      const next = withListEdited(cardRef.current, list, ids)
      update({ setsUpIds: next.setsUpIds, paysOffIds: next.paysOffIds, threadLinks: next.threadLinks })
    },
    [update]
  )
  const setSetsUp = useCallback((setsUpIds: ID[]) => editThreads('setsUp', setsUpIds), [editThreads])
  const setPaysOff = useCallback((paysOffIds: ID[]) => editThreads('paysOff', paysOffIds), [editThreads])
  // The memory links plot threads to this scene as it reads it: its links show as they come and go.
  const memoryRev = useApp((s) => s.memoryRev)
  useEffect(() => {
    if (!cardRef.current) return
    let live = true
    api
      .getScene(sceneId)
      .then((s) => {
        const mine = cardRef.current
        if (!live || !mine) return
        const merged = mergeThreadLinks(s.card, mine)
        if (merged === mine) return
        cardRef.current = merged
        setCard(merged)
        if (cardDrafts.get(sceneId)) cardDrafts.set(sceneId, merged)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [sceneId, memoryRev])
  const links = card?.threadLinks
  const setsUpList = card?.setsUpIds
  const paysOffList = card?.paysOffIds
  const setsUpAi = useMemo(() => aiLinked({ setsUpIds: setsUpList ?? [], paysOffIds: [], threadLinks: links }, 'setsUp'), [setsUpList, links])
  const paysOffAi = useMemo(() => aiLinked({ setsUpIds: [], paysOffIds: paysOffList ?? [], threadLinks: links }, 'paysOff'), [paysOffList, links])
  const characters = useMemo(() => (entries ?? []).filter((e) => e.kind === 'character'), [entries])
  const places = useMemo(() => (entries ?? []).filter((e) => e.kind === 'place'), [entries])
  const threads = useMemo(() => (entries ?? []).filter((e) => e.kind === 'thread'), [entries])
  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])
  const povOptions = useMemo(() => characters.map((c) => ({ value: c.id, label: c.name.trim() || 'Unnamed' })), [characters])
  const locOptions = useMemo(() => placeOptions(places), [places])

  // Entries made here are made in this scene's story, so the memory knows where they first exist.
  const createCharacter = useCallback(async (name: string): Promise<Entry | null> => {
    try {
      const e = await api.createEntry('character', { name, originStoryId: useApp.getState().storyId })
      setEntries((prev) => [...(prev ?? []), e])
      useApp.getState().bumpEntries()
      toast(`Added ${e.name} to your characters. Fill in their profile under Characters when you're ready.`)
      return e
    } catch (err) {
      toast(`Couldn't add ${name}. ${(err as Error).message}`, { tone: 'danger' })
      return null
    }
  }, [])

  const createThread = useCallback(async (name: string): Promise<Entry | null> => {
    try {
      const e = await api.createEntry('thread', { name, originStoryId: useApp.getState().storyId })
      setEntries((prev) => [...(prev ?? []), e])
      useApp.getState().bumpEntries()
      toast(`Added “${e.name}” to your plot threads.`)
      return e
    } catch (err) {
      toast(`Couldn't add ${name}. ${(err as Error).message}`, { tone: 'danger' })
      return null
    }
  }, [])

  const ids = {
    beats: useId(),
    beatsHint: useId(),
    setsUp: useId(),
    setsUpHint: useId(),
    paysOff: useId(),
    paysOffHint: useId()
  }
  const slow = useSlow(!card && !error)

  // "Mark paid off" (the desk's plot threads page): once the card is here, the thread goes under Pays off as typing its
  // name there would, the field comes into view, and the toast's Undo takes it off again.
  const loaded = !!card
  useEffect(
    () =>
      registerPayOffPanel(sceneId, (threadId) => {
        if (cardRef.current) setPaysOff(cardRef.current.paysOffIds.filter((id) => id !== threadId))
      }),
    [sceneId, setPaysOff]
  )
  useEffect(() => {
    if (!loaded || !cardRef.current) return
    const req = takePayOff(sceneId)
    if (!req) return
    if (!cardRef.current.paysOffIds.includes(req.threadId)) {
      setPaysOff([...cardRef.current.paysOffIds, req.threadId])
      toast(`Marked “${req.name}” as paid off in this scene.`, { action: { label: 'Undo', run: () => void undoPayOff(sceneId, req.threadId) } })
    }
    requestAnimationFrame(() => document.getElementById(ids.paysOff)?.scrollIntoView({ block: 'center' }))
  }, [loaded, sceneId, setPaysOff, ids.paysOff])

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
  /** A part the chapter card carries: tagged "From chapter" while it follows one the chapter card has, else "Use chapter's". */
  const carry = (f: CarryField): { follows: boolean; canUse: boolean; onUse: () => void } => {
    const has = !!chapter && !isFieldEmpty(chapter.card, f)
    const on = follows(card, f)
    return { follows: on && has, canUse: has && !on, onUse: () => followChapter(f) }
  }

  return (
    <div className="flex animate-fade-in flex-col gap-5 px-4 pb-12 pt-4" onBlur={() => void autosave.flush()}>
      <PlanInterview target={interviewTarget} />
      <SceneIdeas
        sceneId={sceneId}
        card={card}
        onUse={fillFromIdea}
        beside={interview ? null : <InterviewButton target={interviewTarget} />}
      />
      <Group title="Who and where" icon={Users} action={<SaveNote status={autosave.status} error={autosave.error} />}>
        <CarryRow
          label="Point of view"
          {...carry('pov')}
          hint={characters.length ? 'The scene is told through their eyes.' : 'No characters yet. Type a name under Characters present to add one.'}
        >
          {(id) => <OptionSelect id={id} value={povValue} onChange={setPov} options={povOptions} />}
        </CarryRow>
        <CarryRow label="Characters present" {...carry('present')} hint="Characters named here are given to the AI with their full profile.">
          {(id, hintId) => (
            <CastPicker
              id={id}
              aria-describedby={hintId}
              value={card.presentIds}
              povId={povValue}
              characters={characters}
              onChange={setPresent}
              onCreate={createCharacter}
            />
          )}
        </CarryRow>
        <CarryRow label="Location" {...carry('location')} hint={places.length ? undefined : 'No places yet. Add one under Places.'}>
          {(id) => <OptionSelect id={id} value={locValue} onChange={setLocation} options={locOptions} />}
        </CarryRow>
        <CarryRow label="When" {...carry('when')} hint="In-world date and time, in your own words.">
          {(id, hintId) => (
            <Input
              id={id}
              aria-describedby={hintId}
              value={card.when}
              placeholder="Day 12, Year 3, at dusk"
              onChange={(e) => update({ when: e.target.value })}
            />
          )}
        </CarryRow>
      </Group>

      <Group title="What happens" icon={ListOrdered}>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.beats} className="text-[12px] font-medium text-muted">
            Beats
          </label>
          <p id={ids.beatsHint} className="-mt-0.5 mb-0.5 text-[12px] text-faint">
            The 3 to 8 things that must happen, in order
          </p>
          <BeatsEditor key={beatsRev} id={ids.beats} aria-describedby={ids.beatsHint} initial={card.beats} onChange={onBeats} />
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
        <BringAbout sceneId={sceneId} entries={byId} />
      </Group>

      <Group title="Plot threads" icon={Spool}>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.setsUp} className="text-[12px] font-medium text-muted">
            Sets up
          </label>
          <CastPicker
            id={ids.setsUp}
            aria-describedby={ids.setsUpHint}
            value={card.setsUpIds}
            characters={threads}
            aiIds={setsUpAi}
            onChange={setSetsUp}
            onCreate={createThread}
            noun="plot thread"
            listLabel="Plot threads"
          />
          <p id={ids.setsUpHint} className="text-[12px] text-faint">
            Mysteries, promises and setups this scene opens. Type a name to add a new one. The AI adds those it reads in your text.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.paysOff} className="text-[12px] font-medium text-muted">
            Pays off
          </label>
          <CastPicker
            id={ids.paysOff}
            aria-describedby={ids.paysOffHint}
            value={card.paysOffIds}
            characters={threads}
            aiIds={paysOffAi}
            onChange={setPaysOff}
            onCreate={createThread}
            noun="plot thread"
            listLabel="Plot threads"
          />
          <p id={ids.paysOffHint} className="text-[12px] text-faint">
            Threads this scene resolves.
          </p>
        </div>
      </Group>

      <Group title="How it reads" icon={Feather}>
        <CarryRow label="Mood or tone" {...carry('mood')}>
          {(id) => <Input id={id} value={card.mood} placeholder="Quiet and tense, with a bitter edge" onChange={(e) => update({ mood: e.target.value })} />}
        </CarryRow>
        <CarryRow label="Length" {...carry('length')} hint="Auto lets the AI pick the length the scene needs.">
          {(id) => (
            <TargetLength
              id={id}
              value={cardLength(card)}
              onChange={(n) => update(n == null ? { lengthSet: false } : { targetWords: n, lengthSet: true })}
            />
          )}
        </CarryRow>
        <CarryRow label="Notes for the AI" {...carry('notes')} hint="Names you mention in the beats and notes are looked up in your world too.">
          {(id, hintId) => (
            <AutoTextarea
              id={id}
              aria-describedby={hintId}
              value={card.notes}
              minRows={3}
              maxRows={16}
              placeholder="Anything else to keep in mind, like a callback to an earlier scene"
              onChange={(e) => update({ notes: e.target.value })}
            />
          )}
        </CarryRow>
      </Group>

      <Group
        title="Summary"
        icon={TextQuote}
        action={
          <button
            type="button"
            onClick={() => useApp.getState().navigate({ kind: 'memory', sceneId })}
            className="rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            What changed here
          </button>
        }
      >
        <SceneSummary sceneId={sceneId} />
      </Group>
    </div>
  )
}

export const OptionSelect = memo(function OptionSelect({
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

/** One part of the card. The New look shows it as a card of its own, its small-caps head led by an icon. */
export function Group({ title, icon: Icon, action, children }: { title: string; icon: IconType; action?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3.5 border-t border-line pt-4 first:border-t-0 first:pt-0 look-new:rounded-card look-new:border-t-0 look-new:bg-surface look-new:p-3.5 look-new:shadow-[inset_0_0_0_1px_var(--line)] look-new:first:pt-3.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint look-new:tracking-[0.08em]">
          <Icon size={14} className="hidden text-accent look-new:inline" aria-hidden />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The scene's length: Auto (the AI picks the length the scene needs) unless Adam sets a word count. */
export function TargetLength({ id, value, onChange }: { id: string; value: number | null; onChange: (n: number | null) => void }): React.JSX.Element {
  const [text, setText] = useState(value != null ? String(value) : '')
  useEffect(() => setText(value != null ? String(value) : ''), [value])
  const set = (n: number | null): void => {
    setText(n != null ? String(n) : '')
    onChange(n)
  }
  const chip = (on: boolean): string =>
    cn(
      'h-6 rounded-full border px-2 text-[12px] tabular-nums transition-colors duration-150',
      on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg'
    )
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
          placeholder="Auto"
          onChange={(e) => {
            setText(e.target.value)
            // An empty box is Auto.
            if (e.target.value.trim() === '') return onChange(null)
            const n = Math.round(Number(e.target.value))
            if (Number.isFinite(n) && n >= 100 && n <= 20000) onChange(n)
          }}
          onBlur={() => setText(value != null ? String(value) : '')}
          className="w-[76px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {/* Kept in its place with Auto, so the quick lengths don't move. */}
        <span className={cn('text-[13px] text-muted', value == null && 'invisible')} aria-hidden={value == null}>
          words
        </span>
      </div>
      <div className="flex gap-1" role="group" aria-label="Quick lengths">
        <button type="button" aria-pressed={value == null} onClick={() => set(null)} className={chip(value == null)}>
          Auto
        </button>
        {LENGTH_PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={value === p} onClick={() => set(p)} className={chip(value === p)}>
            {p.toLocaleString('en-GB')}
          </button>
        ))}
      </div>
    </div>
  )
}
