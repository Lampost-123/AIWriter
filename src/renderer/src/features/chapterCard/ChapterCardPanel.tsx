// A chapter's card in the right-hand panel (2026-10-08), opened by clicking the chapter in the binder or "Chapter
// card" in its menu: what the chapter's scenes share (point of view, characters present, location, when, mood,
// length and notes for the AI), laid out like the scene card. It saves as Adam types; each change goes into the
// scene cards that follow the chapter, and "Updated 3 scenes · Undo" puts them back (chapterCardEvents.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChapterCard, Entry, ID } from '@shared/types'
import { emptyChapterCard } from '@shared/chapterCard'
import { cardLength } from '@shared/defaults'
import { Button, Field, IconButton, Input, Notice, Spinner, toast } from '@/components/ui'
import { ArrowLeft, Feather, Users, X } from '@/components/ui/icons'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { placeOptions } from '@/features/world/entryLogic'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { useSlow } from '@/features/world/parts/useSlow'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { CastPicker } from '@/features/inspector/CastPicker'
import { Group, OptionSelect, TargetLength } from '@/features/inspector/SceneCardPanel'
import { announceChapterCard, endChapterCardBatch, registerChapterCardForm, scenesWord, takeChapterCardFocus } from './chapterCardEvents'

export function ChapterCardPanel({ chapterId, onClose, closeLabel }: { chapterId: ID; onClose: () => void; closeLabel: string | null }): React.JSX.Element {
  return <ChapterCardForm key={chapterId} chapterId={chapterId} onClose={onClose} closeLabel={closeLabel} />
}

function ChapterCardForm({ chapterId, onClose, closeLabel }: { chapterId: ID; onClose: () => void; closeLabel: string | null }): React.JSX.Element {
  const entriesRev = useApp((s) => s.entriesRev)
  const outline = useOutlineStore((s) => s.outline)
  const chapter = outline?.chapters.find((c) => c.id === chapterId) ?? null
  const sceneCount = outline ? outline.scenes.filter((s) => s.chapterId === chapterId).length : null
  const [card, setCard] = useState<ChapterCard | null>(null)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const cardRef = useRef<ChapterCard | null>(null)
  /** The card as last saved: what a change's Undo puts back. */
  const savedRef = useRef<ChapterCard | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const autosave = useAutosave<ChapterCard>(
    async (c) => {
      const before = savedRef.current ?? emptyChapterCard()
      const saved = await api.updateChapterCard(chapterId, c)
      savedRef.current = saved.card
      announceChapterCard(chapterId, before, saved)
    },
    { what: 'the chapter card' }
  )
  const { schedule, cancel, flush } = autosave
  // Closed: once its last change is written (into the same toast), the next change starts a toast of its own.
  useEffect(() => () => void flush().then(() => endChapterCardBatch(chapterId)), [chapterId, flush])

  useEffect(() => {
    let live = true
    api
      .getChapterCard(chapterId)
      .then((c) => {
        if (!live) return
        cardRef.current = c
        savedRef.current = c
        setCard(c)
        setError(null)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [chapterId, attempt])

  // An Undo of a change shows here at once. (Its last change, written as the card closes, joins the same toast.)
  useEffect(
    () =>
      registerChapterCardForm(chapterId, (back) => {
        cancel()
        cardRef.current = back
        savedRef.current = back
        setCard(back)
      }),
    [chapterId, cancel]
  )

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

  // Opened from the chapter's menu: the keyboard carries on in the card (a click leaves it where it was).
  useEffect(() => {
    if (!takeChapterCardFocus()) return
    requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }))
  }, [chapterId])

  const update = useCallback(
    (patch: Partial<ChapterCard>) => {
      if (!cardRef.current) return
      const next = { ...cardRef.current, ...patch }
      cardRef.current = next
      setCard(next)
      schedule(next)
    },
    [schedule]
  )
  const setPov = useCallback((povId: ID | null) => update({ povId }), [update])
  const setLocation = useCallback((locationId: ID | null) => update({ locationId }), [update])
  const setPresent = useCallback((presentIds: ID[]) => update({ presentIds }), [update])
  const characters = useMemo(() => (entries ?? []).filter((e) => e.kind === 'character'), [entries])
  const places = useMemo(() => (entries ?? []).filter((e) => e.kind === 'place'), [entries])
  const povOptions = useMemo(() => characters.map((c) => ({ value: c.id, label: c.name.trim() || 'Unnamed' })), [characters])
  const locOptions = useMemo(() => placeOptions(places), [places])

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

  const slow = useSlow(!card && !error)
  const title = chapter?.title.trim() || 'Untitled chapter'

  const header = (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-2">
      {closeLabel ? (
        <Button ref={closeRef} variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onClose}>
          Back to {closeLabel}
        </Button>
      ) : (
        <span className="px-2 text-[13px] font-semibold text-fg">Chapter card</span>
      )}
      {closeLabel ? null : (
        <IconButton ref={closeRef} size="sm" label="Close the chapter card" onClick={onClose}>
          <X size={15} />
        </IconButton>
      )}
    </div>
  )

  let body: React.ReactNode
  if (error && !card) {
    body = (
      <div className="p-4">
        <Notice
          tone="danger"
          action={
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          Couldn't load this chapter's card. {error}
        </Notice>
      </div>
    )
  } else if (!card || !entries) {
    body = slow ? (
      <div className="flex justify-center py-10 text-faint">
        <Spinner />
      </div>
    ) : (
      <div />
    )
  } else {
    const povValue = card.povId && characters.some((c) => c.id === card.povId) ? card.povId : null
    const locValue = card.locationId && places.some((p) => p.id === card.locationId) ? card.locationId : null
    body = (
      <div className="flex animate-fade-in flex-col gap-5 px-4 pb-12 pt-4" onBlur={() => void autosave.flush()}>
        <div>
          <h2 className="text-[16px] font-semibold leading-6 text-fg">
            <span className="sr-only">Chapter card: </span>
            {title}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            What this chapter’s scenes share. {sceneCount ? `Its ${scenesWord(sceneCount)} follow` : 'Its scenes follow'} each part
            until you give a scene its own on its card. New scenes start with it.
          </p>
        </div>
        <Group title="Who and where" icon={Users} action={<SaveNote status={autosave.status} error={autosave.error} />}>
          <Field label="Point of view" hint={characters.length ? 'Whose eyes most of the chapter is seen through.' : 'No characters yet. Type a name under Characters present to add one.'}>
            {(id) => <OptionSelect id={id} value={povValue} onChange={setPov} options={povOptions} />}
          </Field>
          <Field label="Characters present" hint="Who is in most of its scenes.">
            {(id) => <CastPicker id={id} value={card.presentIds} povId={povValue} characters={characters} onChange={setPresent} onCreate={createCharacter} />}
          </Field>
          <Field label="Location" hint={places.length ? 'Where most of it happens.' : 'No places yet. Add one under Places.'}>
            {(id) => <OptionSelect id={id} value={locValue} onChange={setLocation} options={locOptions} />}
          </Field>
          <Field label="When" hint="When the chapter starts, in your own words.">
            {(id) => <Input id={id} value={card.when} placeholder="Day 12, Year 3, at dusk" onChange={(e) => update({ when: e.target.value })} />}
          </Field>
        </Group>
        <Group title="How it reads" icon={Feather}>
          <Field label="Mood or tone">
            {(id) => <Input id={id} value={card.mood} placeholder="Quiet and tense, with a bitter edge" onChange={(e) => update({ mood: e.target.value })} />}
          </Field>
          <Field label="Length" hint="Each scene’s length. Auto lets the AI pick the length a scene needs.">
            {(id) => (
              <TargetLength
                id={id}
                value={cardLength(card)}
                onChange={(n) => update(n == null ? { lengthSet: false } : { targetWords: n, lengthSet: true })}
              />
            )}
          </Field>
          <Field label="Notes for the AI" hint="Given with every scene in the chapter that follows them.">
            {(id) => (
              <AutoTextarea
                id={id}
                value={card.notes}
                minRows={3}
                maxRows={16}
                placeholder="Anything every scene in this chapter should keep in mind"
                onChange={(e) => update({ notes: e.target.value })}
              />
            )}
          </Field>
        </Group>
      </div>
    )
  }

  return (
    <section aria-label="Chapter card" className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </section>
  )
}
