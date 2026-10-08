// An entry's editing, shared by the panels' entry page (EntryForm) and the desk's dossier (world/dossier/Dossier.tsx):
// the copy on the page, saving as Adam types (written over the newest saved copy, so a memory update that landed meanwhile
// isn't undone), taking in a newer copy without losing what he typed, an earlier version brought back, deleting with
// Undo, and an edit made while working in a later story offering to keep it for that story on ("Only from <story> on").
// Moved here from EntryForm.tsx unchanged, so both pages save the same way.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Entry, ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { confirmSaved, entryReplaced, getDraft, onEntryReplaced, setDraft } from './entryDrafts'
import { deleteEntryWithUndo, toPatch } from './entryActions'
import { kindNoun, mergeEntry, saveOverNewer } from './entryLogic'
import { homesOf } from './FirstAppears'
import { notesSource } from './memoryLogic'
import { useEntryData } from './memory/useEntryData'
import { beforeOf, editedKeys, profileOf, reachStory, rebase, type Profile } from './reachLogic'
import { useAutosave } from './parts/useAutosave'

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** The names an entry goes by, as one string: "Appears in" looks for them in the scenes' words. */
const namesOf = (e: Pick<Entry, 'name' | 'aliases'>): string => [e.name, ...e.aliases].map((n) => n.trim()).join('\n')

/** Who an entry's facts come from, as the page last heard from the database. */
export type Ownership = Pick<Entry, 'origin' | 'fieldOrigins' | 'byHand' | 'originSceneId'>
export const ownership = (e: Entry): Ownership => ({
  origin: e.origin,
  fieldOrigins: e.fieldOrigins ?? {},
  byHand: e.byHand,
  originSceneId: e.originSceneId
})

export function useEntryEditor(
  initial: Entry,
  {
    onLiveChange,
    onDeleted,
    noteKeys
  }: {
    onLiveChange: (e: Entry) => void
    onDeleted: (e: Entry) => void
    /** Every field that can say where its words came from. */
    noteKeys: string[]
  }
) {
  const kind = initial.kind
  const [draft, setDraftState] = useState(initial)
  const draftRef = useRef(initial)
  const liveRef = useRef(onLiveChange)
  liveRef.current = onLiveChange
  // Bumped when a list is replaced from outside, so the input that keeps its own text for it starts again.
  // One each, so a change to the aliases never resets (and takes the cursor out of) the tags.
  const [rev, setRev] = useState({ aliases: 0, tags: 0 })
  // Who the entry and its fields come from: kept up to date from each save (an edit makes them Adam's).
  const [owner, setOwner] = useState(() => ownership(initial))
  // Where each field came from, as it was when the page opened: those notes stay put while Adam types.
  const [sources, setSources] = useState(() => initial)
  // The names it goes by as last saved, for reloading "Appears in" when they change.
  const [savedNames, setSavedNames] = useState(() => namesOf(initial))
  // The newest saved copy this form knows of (and its time), so a newer one loaded from elsewhere
  // can be merged with what Adam has typed rather than overwrite it.
  const base = useRef(initial)
  const known = useRef(initial.updatedAt)
  // The profile before Adam's edits that reach other stories, for "Only from <story> on" (see reachLogic.ts).
  const [reachFrom, setReachFrom] = useState<Profile>(() => profileOf(initial))

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
  const { schedule, cancel } = autosave
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

  const deleting = useRef(false)
  const onDeletedRef = useRef(onDeleted)
  onDeletedRef.current = onDeleted
  const remove = useCallback(async (): Promise<void> => {
    if (deleting.current) return
    deleting.current = true
    // Write any last edit first, so Undo brings back exactly what was on screen.
    await autosave.flush()
    autosave.cancel()
    if (await deleteEntryWithUndo(draftRef.current)) onDeletedRef.current(draftRef.current)
    else deleting.current = false
  }, [autosave])

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

  return {
    draft,
    draftRef,
    rev,
    owner,
    sources,
    savedNames,
    reachFrom,
    setReachFrom,
    base,
    opened,
    autosave,
    adopt,
    takeNewer,
    update,
    setField,
    setParent,
    setName,
    remove,
    firsts,
    reach,
    reaching,
    keeping,
    keepFromHere
  }
}

export type EntryEditor = ReturnType<typeof useEntryEditor>
