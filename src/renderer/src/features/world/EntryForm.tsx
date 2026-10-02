import { AlertTriangle, History, Info, Lock, Trash2, WandSparkles, X } from 'lucide-react'
import { forwardRef, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CHARACTER_ROLES, FIELD_GROUPS, KIND_LABELS, type FieldDef, type FieldGroup } from '@shared/fields'
import type { Entry, EntryKind, ID, Origin } from '@shared/types'
import type { BuilderKind } from '@shared/contracts/builder'
import { Button, Field, IconButton, Input, Select, toast } from '@/components/ui'
import { AutoTextarea, useFitHeight } from './parts/AutoTextarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { PortraitDrop } from '@/features/views/PortraitDrop'
import { setAsOfMode, useAsOfMode } from './asOfMode'
import { EntryAsOfView } from './AsOfView'
import { confirmSaved, entryReplaced, getDraft, onEntryReplaced, setDraft, takeFresh } from './entryDrafts'
import { deleteEntryWithUndo, toPatch } from './entryActions'
import {
  filledCount,
  findNearDuplicates,
  kindNoun,
  mergeEntry,
  parentPlaceOptions,
  saveOverNewer,
  withArticle,
  type NearDuplicate,
  type PlaceOption
} from './entryLogic'
import { FirstAppears, homesOf } from './FirstAppears'
import { EntryMemorySections } from './memory/EntryMemory'
import { MadeByNote, YouWroteNote } from './memory/EntryNotes'
import { SourceLine, type LineNote } from './memory/SourceLine'
import { useEntryData } from './memory/useEntryData'
import { fieldOrigin, fieldText, linksFor, notesSource, sourceNote } from './memoryLogic'
import { beforeOf, dismissProfile, editedKeys, profileOf, reachButton, reachNote, reachStory, rebase, type Profile } from './reachLogic'
import { useSceneLabels, type ScenePlace } from './useSceneLabels'
import { SaveNote } from './parts/SaveNote'
import { Section } from './parts/Section'
import { Switch } from './parts/Switch'
import { CommaListInput } from './parts/TextInputs'
import { useAutosave } from './parts/useAutosave'

const COPY: Partial<Record<EntryKind, { summary: string; description: string; aliases: string; aliasesHint: string }>> = {
  character: {
    summary: 'A grumpy ex-soldier who runs the ferry and owes the Duke money',
    description: 'Who they are, in your own words. The sections below help you fill in the detail.',
    aliases: "nicknames, titles, 'the old woman'",
    aliasesHint: 'Separate with commas. Used to spot them in your text.'
  },
  place: {
    summary: 'A salt-crusted port where nobody asks questions',
    description: 'What it is, what it feels like to be there, and why it matters to the story.',
    aliases: "other names, like 'the Old Keep'",
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  },
  group: {
    summary: 'A guild of smugglers who answer to no crown',
    description: 'Who they are, what they stand for, and how others see them.',
    aliases: "other names, like 'the Brotherhood'",
    aliasesHint: 'Separate with commas. Used to spot them in your text.'
  },
  item: {
    summary: 'A cracked compass that always points to the person you miss',
    description: 'What it looks like and why it matters to the story.',
    aliases: "other names, like 'the old blade'",
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  },
  lore: {
    summary: 'Every spell costs the caster a memory',
    description: 'How it works, where it came from, and who knows about it.',
    aliases: "other names, like 'the Binding'",
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  },
  event: {
    summary: 'The night the harbour burned',
    description: 'What happened, in your own words, and why it still matters.',
    aliases: "other names, like 'the Burning'",
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  },
  thread: {
    summary: 'Who left the letter on Mara’s pillow?',
    description: 'The mystery, setup or conflict, and what the reader is waiting for.',
    aliases: "other names, like 'the letter'",
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  },
  glossary: {
    summary: 'A ferry token, stamped with the river god',
    description: 'What it means, and where the word comes from.',
    aliases: 'other spellings or forms, like the plural',
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  }
}

const ROLE_OPTIONS = CHARACTER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))

/** Kinds with a portrait and a builder (milestone 3). */
const PICTURED: EntryKind[] = ['character', 'place', 'group', 'item']
const isPictured = (kind: EntryKind): kind is BuilderKind => PICTURED.includes(kind)

// Which sections are open, remembered per kind for this session and the next.
const DEFAULT_OPEN: Partial<Record<EntryKind, string[]>> = {
  character: ['basics'],
  place: ['place'],
  group: ['group'],
  item: ['item'],
  lore: ['lore'],
  event: ['event'],
  thread: ['thread'],
  glossary: ['glossary']
}
function loadOpen(kind: EntryKind): string[] {
  try {
    const raw = localStorage.getItem(`aiwrite.entrySections.${kind}`)
    const ids: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string')
  } catch {
    // Storage can be unavailable; fall back to the defaults.
  }
  return DEFAULT_OPEN[kind] ?? []
}
function saveOpen(kind: EntryKind, ids: string[]): void {
  try {
    localStorage.setItem(`aiwrite.entrySections.${kind}`, JSON.stringify(ids))
  } catch {
    // Not important enough to report.
  }
}

export interface EntryFormProps {
  /** The entry as it was when the form opened. The form owns the copy from then on. */
  initial: Entry
  /** Every other entry in the world, for the near-duplicate hint. */
  others: Entry[]
  /** Every place in the world, for "Inside". */
  places: Entry[]
  /** Called when anything shown in the list changes (name, summary, aliases...). */
  onLiveChange: (e: Entry) => void
  onDeleted: (e: Entry) => void
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** The names an entry goes by, as one string: "Appears in" looks for them in the scenes' words. */
const namesOf = (e: Pick<Entry, 'name' | 'aliases'>): string => [e.name, ...e.aliases].map((n) => n.trim()).join('\n')

/** Whether anything is written in the entry besides its name. */
const hasWords = (e: Entry): boolean =>
  !!(e.summary.trim() || e.description.trim() || e.aliases.length || e.tags.length || Object.values(e.fields).some((v) => v.trim()))

/** Who an entry's facts come from, as the page last heard from the database. */
type Ownership = Pick<Entry, 'origin' | 'fieldOrigins' | 'byHand' | 'originSceneId'>
const ownership = (e: Entry): Ownership => ({
  origin: e.origin,
  fieldOrigins: e.fieldOrigins ?? {},
  byHand: e.byHand,
  originSceneId: e.originSceneId
})

/** The form for any kind of entry, with its memory sections underneath. Saves itself as Adam types. */
export const EntryForm = memo(function EntryForm({
  initial,
  others,
  places,
  onLiveChange,
  onDeleted,
  onOpen
}: EntryFormProps): React.JSX.Element {
  const kind = initial.kind
  const [draft, setDraftState] = useState(initial)
  const draftRef = useRef(initial)
  const liveRef = useRef(onLiveChange)
  liveRef.current = onLiveChange
  const nameRef = useRef<HTMLTextAreaElement>(null)
  const ids = { notes: useId(), hard: useId() }
  // Bumped when a list is replaced from outside, so the input that keeps its own text for it starts again.
  // One each, so a change to the aliases never resets (and takes the cursor out of) the tags.
  const [rev, setRev] = useState({ aliases: 0, tags: 0 })
  // Who the entry and its fields come from: kept up to date from each save (an edit makes them Adam's).
  const [owner, setOwner] = useState(() => ownership(initial))
  // Where each field came from, as it was when the page opened: those notes stay put while Adam types.
  const [sources, setSources] = useState(() => initial)
  // Whether AI Write made this entry and Adam hadn't touched it when the page opened (the note's line is kept while open).
  const [madeByAI] = useState(() => initial.origin !== 'adam' && !initial.byHand)
  // Whether Adam made it himself and has written in it: then a note says so (also kept while open).
  const [madeByAdam] = useState(() => initial.origin === 'adam' && hasWords(initial))
  // The names it goes by as last saved, for reloading "Appears in" when they change.
  const [savedNames, setSavedNames] = useState(() => namesOf(initial))
  // The newest saved copy this form knows of (and its time), so a newer one loaded from elsewhere
  // can be merged with what Adam has typed rather than overwrite it.
  const base = useRef(initial)
  const known = useRef(initial.updatedAt)
  // The profile before Adam's edits that reach other stories, for "Only from <story> on" (see reachLogic.ts).
  const [reachFrom, setReachFrom] = useState<Profile>(() => profileOf(initial))

  const copy = COPY[kind]
  const groups = FIELD_GROUPS[kind] ?? []
  // Every field that can say where its words came from.
  const noteKeys = useMemo(
    () => ['aliases', 'summary', 'description', 'tags', ...groups.flatMap((g) => g.fields.map((f) => f.key))],
    [groups]
  )
  const noteKeysRef = useRef(noteKeys)
  noteKeysRef.current = noteKeys

  // Shows a newer saved copy of the entry, with `shown` (that copy, or it merged with Adam's edits) on the page.
  const adopt = useCallback((saved: Entry, shown: Entry) => {
    const before = draftRef.current
    base.current = saved
    known.current = saved.updatedAt
    draftRef.current = shown
    setDraftState(shown)
    setOwner(ownership(saved))
    setSavedNames(namesOf(saved))
    setSources((prev) => notesSource(prev, saved, noteKeysRef.current))
    // Lists typed as text keep their own words: start one again only when it changed.
    const aliases = !sameList(before.aliases, shown.aliases)
    const tags = !sameList(before.tags, shown.tags)
    if (aliases || tags) setRev((r) => ({ aliases: r.aliases + (aliases ? 1 : 0), tags: r.tags + (tags ? 1 : 0) }))
    liveRef.current(shown)
  }, [])

  // A save of Adam's (or a reload) brought a newer copy, say with a field the memory keeper filled in
  // while he typed: show it, keeping whatever he has typed since `since`.
  const scheduleRef = useRef<(e: Entry) => void>(() => undefined)
  const takeNewer = useCallback(
    (saved: Entry, since: Entry) => {
      const shown = mergeEntry(since, draftRef.current, saved)
      // What someone else changed meanwhile is the new starting point, never taken for Adam's edit.
      const mine = draftRef.current
      setReachFrom((prev) => rebase(prev, mine, saved))
      adopt(saved, shown)
      // Edits still waiting to be saved are sent again on top of the newer copy.
      if (getDraft(saved.id)) {
        setDraft(shown)
        scheduleRef.current(shown)
      }
    },
    [adopt]
  )

  const autosave = useAutosave<Entry>(
    async (e) => {
      // Written over the newest saved copy, so a memory update that landed while Adam typed isn't undone.
      const { sent, saved } = await saveOverNewer(e, base.current, {
        get: (id) => api.getEntry(id),
        put: (x) => api.updateEntry(x.id, toPatch(x))
      })
      confirmSaved(e)
      if (sent !== e) takeNewer(saved, e)
      else if (saved.updatedAt > known.current) {
        known.current = saved.updatedAt
        base.current = saved
      }
      setOwner(ownership(saved))
      setSavedNames(namesOf(saved))
      useApp.getState().bumpEntries()
    },
    { what: draft.name.trim() ? `"${draft.name.trim()}"` : `this ${kindNoun(kind)}` }
  )
  const { schedule, cancel, flush } = autosave
  scheduleRef.current = schedule

  const update = useCallback(
    (patch: Partial<Entry>) => {
      const next = { ...draftRef.current, ...patch }
      draftRef.current = next
      setDraftState(next)
      setDraft(next)
      schedule(next)
      if ('name' in patch || 'summary' in patch || 'aliases' in patch || 'hardRule' in patch || 'parentId' in patch) liveRef.current(next)
    },
    [schedule]
  )

  // The memory keeper changed this entry while its page was open: show the newer copy, keeping what Adam typed.
  useEffect(() => {
    if (initial.id !== draftRef.current.id || initial.updatedAt <= known.current || getDraft(initial.id) === initial) return
    takeNewer(initial, base.current)
  }, [initial, takeNewer])

  // An earlier version was brought back (or that was undone): show it, whatever was waiting to be saved.
  useEffect(
    () =>
      onEntryReplaced((e) => {
        if (e.id !== draftRef.current.id) return
        cancel()
        setReachFrom(profileOf(e))
        adopt(e, e)
      }),
    [adopt, cancel]
  )
  // Opened from a copy that isn't confirmed saved yet (re-opened before its write
  // landed, or after a failed write): queue it again so it can't be left unsaved.
  const opened = useRef(initial)
  useEffect(() => {
    const first = opened.current
    if (getDraft(first.id) === first) schedule(first)
  }, [schedule])

  const setField = useCallback((key: string, v: string) => update({ fields: { ...draftRef.current.fields, [key]: v } }), [update])
  const setParent = useCallback((parentId: string | null) => update({ parentId }), [update])
  const setName = useCallback((name: string) => update({ name }), [update])

  // A freshly created entry opens with its name selected, ready to type over (back in editing, if
  // Adam was looking at entries as of a scene).
  const nameFocus = useRef(false)
  const asOf = useAsOfMode((s) => s.on)
  useLayoutEffect(() => {
    if (!takeFresh(initial.id)) return
    nameFocus.current = true
    if (useAsOfMode.getState().on) setAsOfMode({ on: false })
  }, [initial.id])
  useLayoutEffect(() => {
    if (!nameFocus.current || asOf || !nameRef.current) return
    nameFocus.current = false
    nameRef.current.focus()
    nameRef.current.select()
  }, [asOf, initial.id])

  const dups = useMemo(
    () => findNearDuplicates({ id: draft.id, kind, name: draft.name, aliases: draft.aliases }, others),
    [draft.id, kind, draft.name, draft.aliases, others]
  )

  const [open, setOpen] = useState(() => new Set(loadOpen(kind)))
  const toggle = useCallback(
    (id: string): void =>
      setOpen((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        saveOpen(kind, [...next])
        return next
      }),
    [kind]
  )

  const deleting = useRef(false)
  const remove = async (): Promise<void> => {
    if (deleting.current) return
    deleting.current = true
    // Write any last edit first, so Undo brings back exactly what was on screen.
    await autosave.flush()
    autosave.cancel()
    if (await deleteEntryWithUndo(draftRef.current)) onDeleted(draftRef.current)
    else deleting.current = false
  }

  const parentOptions = useMemo(() => (kind === 'place' ? parentPlaceOptions(places, draft.id) : []), [kind, places, draft.id])

  // Where each field's words came from, for fields AI Write filled in (read from a scene, or drafted).
  const fromAI = useMemo(() => {
    const m = new Map<string, Origin>()
    for (const key of noteKeys) {
      const origin = fieldOrigin(sources, key)
      if (origin !== 'adam' && fieldText(sources, key).trim()) m.set(key, origin)
    }
    return m
  }, [sources, noteKeys])
  // On an entry AI Write made, the fields that were Adam's own when the page opened say "You wrote
  // this" (on his own entries the note at the top says it once). Decided when the page opens, so no
  // line comes or goes while he types.
  const byAdam = useMemo(() => {
    const e = opened.current
    if (e.origin === 'adam') return []
    return noteKeys.filter((key) => fieldOrigin(e, key) === 'adam' && fieldText(e, key).trim())
  }, [noteKeys])
  const links = useEntryData(() => api.listEntryLinks(initial.id), `links:${initial.id}`, fromAI.size > 0)
  const fieldNotes = useMemo(() => {
    const m = new Map<string, LineNote>()
    for (const key of byAdam) m.set(key, { kind: 'adam' })
    for (const [key, origin] of fromAI) {
      // Adam has changed it since the page opened: it's his now, and the line says so rather than vanish.
      if (fieldOrigin(owner, key) === 'adam') m.set(key, { kind: 'edited' })
      else if (origin === 'ai') m.set(key, { kind: 'ai' })
      else if (!links.data && !links.error) m.set(key, { kind: 'loading' })
      else m.set(key, sourceNote('text', linksFor(links.data ?? [], key)) ?? { kind: 'story' })
    }
    return m
  }, [byAdam, fromAI, owner, links.data, links.error])
  const scenePlaces = useSceneLabels(!!links.data?.length)
  const hint = (key: string, text?: ReactNode): ReactNode => {
    const note = fieldNotes.get(key)
    if (!note) return text
    return (
      <>
        {text ? <span className="block">{text}</span> : null}
        <SourceLine note={note} places={scenePlaces} showAdam className="flex" />
      </>
    )
  }

  // Where it first appears: shown at the top, and it decides whether an edit reaches other stories.
  const firsts = useEntryData(() => api.listFirstExists(initial.id), `first:${initial.id}`)
  const storyId = useApp((s) => s.storyId)
  const stories = useApp((s) => s.stories)
  const reach = reachStory(homesOf(firsts.data), storyId, stories)
  const reaching = reach ? editedKeys(reachFrom, draft) : []
  const [keeping, setKeeping] = useState(false)

  // Turns the edits since the page opened into a change from the start of the story Adam is in,
  // and puts the profile back as it was for every story before it.
  const keepFromHere = async (): Promise<void> => {
    if (!reach || keeping) return
    const keys = editedKeys(reachFrom, draftRef.current)
    if (!keys.length) return
    setKeeping(true)
    try {
      await autosave.flush()
      const edited = draftRef.current
      const { entry, change } = await api.keepEditFromStory(initial.id, reach.id, beforeOf(reachFrom, keys))
      entryReplaced(entry)
      useApp.getState().bumpEntries()
      const who = entry.name.trim() || 'it'
      toast(`From ${reach.title} on, ${who} has the new details. Earlier stories keep what was there before.`, {
        action: { label: 'Undo', run: () => void undoKeep(change.id, edited, keys) }
      })
    } catch (e) {
      toast(`Couldn't keep that for ${reach.title} only. ${(e as Error).message}`, { tone: 'danger' })
    } finally {
      setKeeping(false)
    }
  }
  // Undo: the change goes, and the edits are back on the profile for every story.
  const undoKeep = async (changeId: ID, edited: Entry, keys: string[]): Promise<void> => {
    try {
      await api.deleteChange(changeId)
      const now = await api.getEntry(initial.id)
      const fields = { ...now.fields }
      for (const k of keys) if (k !== 'summary' && k !== 'description') fields[k] = edited.fields[k] ?? ''
      const saved = await api.updateEntry(initial.id, {
        ...toPatch(now),
        summary: keys.includes('summary') ? edited.summary : now.summary,
        description: keys.includes('description') ? edited.description : now.description,
        fields
      })
      entryReplaced(saved)
      useApp.getState().bumpEntries()
    } catch (e) {
      toast(`Couldn't undo that. ${(e as Error).message}`, { tone: 'danger' })
    }
  }

  const asOfButton = useRef<HTMLButtonElement>(null)
  // Only a click on "View as of a scene" moves focus into the slider; opening another entry while
  // looking as of a scene leaves focus where Adam has it (in the list, say).
  const [focusSlider, setFocusSlider] = useState(false)
  const showAsOf = (): void => {
    setFocusSlider(true)
    setAsOfMode({ on: true })
  }
  const backToEditing = (): void => {
    setAsOfMode({ on: false })
    setFocusSlider(false)
    requestAnimationFrame(() => asOfButton.current?.focus())
  }
  const openBuilder = async (): Promise<void> => {
    if (!isPictured(kind)) return
    await autosave.flush()
    useApp.getState().navigate({ kind: 'builder', entryKind: kind, entryId: initial.id })
  }

  return (
    // Leaving any field writes straight away, so nothing waits on the timer.
    <div className="@container mx-auto w-full max-w-[700px] px-8 pb-24 pt-5" onBlur={() => void autosave.flush()}>
      {/* Where it first exists sits beside its kind; on a narrow page, where it would be cut short, on a
          line of its own (kept free while it loads). */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] grid-rows-[2rem] items-center gap-x-2 @max-[34rem]:grid-rows-[2rem_1.25rem]">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{KIND_LABELS[kind].one}</span>
        <FirstAppears
          name={draft.name}
          kind={kind}
          points={firsts}
          className="col-start-2 row-start-1 justify-self-start @max-[34rem]:col-span-4 @max-[34rem]:col-start-1 @max-[34rem]:row-start-2"
        />
        <SaveNote status={autosave.status} error={autosave.error} className="col-start-3 row-start-1" />
        <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} className="col-start-4 row-start-1" onClick={() => void remove()}>
          Delete
        </Button>
      </div>

      <div className="flex items-start gap-4">
        {isPictured(kind) ? (
          <PortraitDrop entry={draft} size={72} onChange={(saved) => takeNewer(saved, base.current)} className="mt-2" />
        ) : null}
        <div className="min-w-0 flex-1">
          {asOf ? (
            <h2 className="mt-1 break-words px-0 py-[5px] font-serif text-[28px] font-semibold leading-tight text-fg">
              {draft.name.trim() || 'Unnamed'}
            </h2>
          ) : (
            <NameBox ref={nameRef} value={draft.name} onChange={setName} />
          )}
          {/* Grows to a second row when the buttons don't fit side by side (the same in both modes, so
              nothing moves between them). */}
          <div className="-ml-2.5 mt-0.5 flex min-h-7 flex-wrap items-center gap-1">
            {/* Stays put (pressed) while looking as of a scene, so nothing beside it moves. */}
            <Button
              ref={asOfButton}
              variant="ghost"
              size="sm"
              icon={<History size={14} />}
              aria-pressed={asOf}
              className={cn(asOf && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
              onClick={asOf ? backToEditing : showAsOf}
            >
              View as of a scene
            </Button>
            {isPictured(kind) ? (
              <Button variant="ghost" size="sm" icon={<WandSparkles size={14} />} onClick={() => void openBuilder()}>
                Open in the builder
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {asOf ? (
        <EntryAsOfView entry={draft} others={others} firsts={firsts.data} onBack={backToEditing} onOpen={onOpen} autoFocus={focusSlider} />
      ) : (
        <>
          {madeByAdam ? <YouWroteNote /> : <MadeByNote entry={owner} shown={madeByAI} />}
          <DuplicateHint dups={dups} kind={kind} onOpen={onOpen} />

          <div className="mt-3 flex flex-col gap-4">
            <Field label="Aliases" hint={hint('aliases', copy?.aliasesHint)}>
              {(id) => (
                <CommaListInput
                  key={rev.aliases}
                  id={id}
                  value={draft.aliases}
                  onChange={(aliases) => update({ aliases })}
                  placeholder={copy?.aliases}
                />
              )}
            </Field>
            <Field label="Short summary" hint={hint('summary')}>
              {(id) => (
                <Input id={id} value={draft.summary} placeholder={copy?.summary} onChange={(e) => update({ summary: e.target.value })} />
              )}
            </Field>

            {kind === 'place' ? (
              <Field label="Inside" hint="The bigger place this one is part of, like a room inside a castle inside a city.">
                {(id) => (
                  <ParentSelect
                    id={id}
                    value={draft.parentId && parentOptions.some((o) => o.value === draft.parentId) ? draft.parentId : null}
                    onChange={setParent}
                    options={parentOptions}
                  />
                )}
              </Field>
            ) : null}

            {kind === 'lore' ? (
              <div
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150',
                  draft.hardRule ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface'
                )}
              >
                <Switch id={ids.hard} checked={draft.hardRule} onChange={(hardRule) => update({ hardRule })} className="mt-px" />
                <label htmlFor={ids.hard} className="flex-1 cursor-default">
                  <span className="block text-[13.5px] font-medium text-fg">Hard rule</span>
                  <span className="block text-[12.5px] text-muted">Never break this rule. Always given to the AI.</span>
                </label>
              </div>
            ) : null}

            <Field label="Description" hint={hint('description')}>
              {(id) => (
                <AutoTextarea
                  id={id}
                  value={draft.description}
                  minRows={4}
                  maxRows={30}
                  placeholder={copy?.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              )}
            </Field>
            <Field label="Tags" hint={hint('tags', 'Separate with commas.')}>
              {(id) => (
                <CommaListInput
                  key={rev.tags}
                  id={id}
                  value={draft.tags}
                  onChange={(tags) => update({ tags })}
                  placeholder="family, the north, book one"
                />
              )}
            </Field>
          </div>

          <div className="mt-6 border-b border-line">
            {groups.map((g) => (
              <GroupSection
                key={g.id}
                group={g}
                fields={draft.fields}
                open={open.has(g.id)}
                onToggle={toggle}
                onField={setField}
                notes={fieldNotes}
                places={scenePlaces}
              />
            ))}
            <EntryMemorySections
              now={draft}
              names={savedNames}
              ready={firsts.data !== null || firsts.error !== null}
              others={others}
              open={open}
              onToggle={toggle}
              onOpen={onOpen}
              beforeRestore={flush}
            />
          </div>

          <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface px-3 pb-3 pt-2.5">
            <label htmlFor={ids.notes} className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <Lock size={12} aria-hidden />
              Private notes (never sent to the AI)
            </label>
            <AutoTextarea
              id={ids.notes}
              value={draft.notes}
              minRows={3}
              maxRows={24}
              placeholder="Reminders for yourself. The AI never sees these."
              onChange={(e) => update({ notes: e.target.value })}
            />
          </div>
        </>
      )}

      {reach && reaching.length && !asOf ? (
        <ReachNote
          name={draft.name}
          story={reach.title}
          busy={keeping}
          onKeep={() => void keepFromHere()}
          onDismiss={() => setReachFrom((prev) => dismissProfile(prev, draftRef.current, owner.fieldOrigins))}
        />
      ) : null}
    </div>
  )
})

/**
 * The one-line note when an edit reaches other stories: "This changes Mara in every story", with
 * "Only from Book 2 on" to keep it for this story on instead. Floats at the bottom of the page so it
 * is seen wherever the edit was made, and never moves the form.
 */
function ReachNote({
  name,
  story,
  busy,
  onKeep,
  onDismiss
}: {
  name: string
  story: string
  busy: boolean
  onKeep: () => void
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="pointer-events-none sticky bottom-4 z-10 mt-6 flex justify-center">
      <div
        role="status"
        className="pointer-events-auto flex max-w-full animate-fade-in items-center gap-2.5 rounded-lg border border-line-strong bg-surface py-1.5 pl-3 pr-1.5 text-[13px] text-fg shadow-pop"
      >
        <Info size={14} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0">{reachNote(name)}</span>
        <Button size="sm" loading={busy} onClick={onKeep}>
          {reachButton(story)}
        </Button>
        <IconButton size="sm" label="Keep it for every story" onClick={onDismiss}>
          <X size={13} />
        </IconButton>
      </div>
    </div>
  )
}

/**
 * The entry's name, as a title. It wraps onto more lines rather than cut off a long one ("The night
 * the harbour burned", "Who left the letter on Mara's pillow?"), and stays one line of text: Enter
 * does nothing, and a pasted line break becomes a space.
 */
const NameBox = memo(
  forwardRef<HTMLTextAreaElement, { value: string; onChange: (v: string) => void }>(function NameBox({ value, onChange }, outer) {
    const inner = useRef<HTMLTextAreaElement | null>(null)
    useFitHeight(inner, value, 1, 4)
    return (
      <textarea
        ref={(el) => {
          inner.current = el
          if (typeof outer === 'function') outer(el)
          else if (outer) outer.current = el
        }}
        rows={1}
        value={value}
        aria-label="Name"
        placeholder="Name"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.replace(/[ \t]*[\r\n]+[ \t]*/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault()
        }}
        className="-mx-2 mt-1 block w-[calc(100%+16px)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 font-serif text-[28px] font-semibold leading-tight text-fg transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    )
  })
)

/** "Inside" for a place. Memoised: a world can hold hundreds of places. */
const ParentSelect = memo(function ParentSelect({
  id,
  value,
  onChange,
  options
}: {
  id: string
  value: string | null
  onChange: (v: string | null) => void
  options: PlaceOption[]
}): React.JSX.Element {
  return <Select id={id} value={value} onChange={onChange} options={options} allowNone noneLabel="Not inside another place" />
})

function DuplicateHint({
  dups,
  kind,
  onOpen
}: {
  dups: NearDuplicate[]
  kind: EntryKind
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
}): React.JSX.Element {
  const d = dups[0]
  // The line is always there (empty when there's nothing to say) so the form never jumps while typing a name.
  if (!d) return <div className="h-6" aria-hidden />
  const other = d.entry
  const otherName = other.name.trim()
  const what = other.kind === kind ? `another ${kindNoun(kind)}` : withArticle(kindNoun(other.kind))
  const more = dups.length > 1 ? `, and ${dups.length - 1} more` : ''
  const text =
    d.reason === 'same'
      ? `There's already ${what} called ${otherName}${more}.`
      : d.reason === 'similar'
        ? `Very close to ${otherName}, ${what}${more}.`
        : `Shares a name with ${otherName}, ${what}${more}.`
  return (
    <div
      role="status"
      title="If they're the same, keep one, so the AI doesn't mix them up."
      className="flex h-6 animate-fade-in items-center gap-1.5 text-[12.5px] text-ai"
    >
      <AlertTriangle size={13} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{text} Same one?</span>
      <button type="button" onClick={() => onOpen(other)} className="shrink-0 font-medium underline-offset-2 hover:underline">
        Open {otherName}
      </button>
    </div>
  )
}

const GroupSection = memo(function GroupSection({
  group,
  fields,
  open,
  onToggle,
  onField,
  notes,
  places
}: {
  group: FieldGroup
  fields: Record<string, string>
  open: boolean
  onToggle: (id: string) => void
  onField: (key: string, v: string) => void
  /** Where AI Write's fields came from, by field key. */
  notes: Map<string, LineNote>
  places: Map<ID, ScenePlace> | null
}): React.JSX.Element {
  const keys = group.fields.map((f) => f.key)
  const filled = filledCount(fields, keys)
  return (
    <Section title={group.label} meta={filled ? `${filled} of ${keys.length}` : null} open={open} onToggle={() => onToggle(group.id)}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 @lg:grid-cols-2">
        {group.fields.map((f) => (
          <FieldInput key={f.key} def={f} value={fields[f.key] ?? ''} onField={onField} note={notes.get(f.key) ?? null} places={places} />
        ))}
      </div>
    </Section>
  )
})

const FieldInput = memo(function FieldInput({
  def,
  value,
  onField,
  note,
  places
}: {
  def: FieldDef
  value: string
  onField: (key: string, v: string) => void
  note: LineNote | null
  places: Map<ID, ScenePlace> | null
}): React.JSX.Element {
  const wide = def.type === 'text'
  return (
    <Field
      label={def.label}
      className={wide ? '@lg:col-span-2' : undefined}
      hint={note ? <SourceLine note={note} places={places} showAdam className="flex" /> : undefined}
    >
      {(id) =>
        def.key === 'role' ? (
          <Select
            id={id}
            value={value || null}
            onChange={(v) => onField(def.key, v ?? '')}
            options={value && !ROLE_OPTIONS.some((o) => o.value === value) ? [...ROLE_OPTIONS, { value, label: value }] : ROLE_OPTIONS}
            allowNone
            noneLabel="Not set"
            placeholder="Not set"
          />
        ) : wide ? (
          <AutoTextarea
            id={id}
            value={value}
            minRows={2}
            maxRows={20}
            placeholder={def.placeholder}
            onChange={(e) => onField(def.key, e.target.value)}
          />
        ) : (
          <Input id={id} value={value} placeholder={def.placeholder} onChange={(e) => onField(def.key, e.target.value)} />
        )
      }
    </Field>
  )
})
