// Saving words from an answer to the memory as Adam's own note (spec, Ask the world: "Anything useful
// can be saved to the memory with one click, as Adam's own note"). The note goes at the end of the
// entry's description as it stands where Adam is (the open scene, else the open story's end): the
// entry's own description when that is what counts there, or else the change that sets it on this
// story's way (a prequel's starting description, a detail pinned to a scene), so the note truly reaches
// the memory he is asking about. Either way the description becomes his, as any hand edit makes it, so
// the memory keeper never changes it. With no entry to add it to, it becomes a new page in Lore.
// In an own version of events nothing may reach another story. When the entry's description there also
// counts in other stories, the note becomes a page in Lore of its own, first existing in that story and
// named after the entry and the question: copying the description into a change there instead would
// quietly stop later edits of the entry from reaching that story. A new page made there first exists
// there too. Everything can be taken back out (the toast's Undo). No Electron imports.

import type Database from 'better-sqlite3'
import type { NoteUndo, SavedNote, SaveNoteInput } from '@shared/contracts/ask'
import type { Change, ChangeInput, Entry, ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { restoreProfile } from '../db/entryViews'
import { setByHand } from '../db/ask'
import { memoryAt, type MemoryAt } from '../memory/asOf'
import { labeler } from '../memory/line'
import { indexChanges } from '../memory/state'
import { loadMemoryData, loadShape } from '../memory/scene'
import type { StoryNode, WorldShape } from '../memory/types'
import { UserError } from '../util'
import { askedFrom, standsAlone, type AskedFrom } from './context'

type DB = Database.Database

/** The most a note can hold (an answer is far shorter). */
export const NOTE_LIMIT = 20_000

/** The words to keep: names without their [[ ]] ("[[Mara Venn|Mara]]" keeps "Mara"), tidy line ends, no runs of blank lines. */
export function noteText(text: string): string {
  return text
    .replace(/\[\[\s*([^[\]\n]+?)\s*\]\]/g, (_m, inner: string) => {
      const [name, shown] = inner.split('|', 2)
      return (shown ?? name).trim() || name.trim()
    })
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A description with a note added at its end, as its own paragraph. */
export const withNote = (description: string, note: string): string => (description.trim() ? `${description.trimEnd()}\n\n${note}` : note)

/** A description with a note's words taken out again (where they last appear); null when they are no longer there. */
export function withoutNote(description: string, note: string): string | null {
  const at = description.lastIndexOf(note)
  if (at < 0) return null
  return `${description.slice(0, at).trimEnd()}\n\n${description.slice(at + note.length).trimStart()}`.trim()
}

const LEAD =
  /^(?:(?:please|ok(?:ay)?|so|now|hey)[\s,]+)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:give|get|show|find|list|suggest|make|write|come up with|think of|brainstorm|tell)(?:\s+(?:me|us))?\s+(?:about\s+)?/i
const COUNT =
  /^(?:(?:a few|a couple of|a|an|some|few|several|more|another|\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\s+)+/i

/** A new note's name, from the question it answers: "Give me ten tavern names that fit the north" → "Tavern names that fit the north". */
export function noteName(question: string, max = 60): string {
  let t = question.replace(/\s+/g, ' ').trim()
  const asked = t.replace(LEAD, '')
  if (asked !== t) t = asked.replace(COUNT, '')
  t = t.replace(/[?.!…:;,\s]+$/, '')
  if (t.length > max) {
    const cut = t.slice(0, max)
    t = cut.replace(/\s+\S*$/, '') || cut
  }
  t = t.charAt(0).toLocaleUpperCase() + t.slice(1)
  return t.length >= 3 ? t : 'A note from Ask the world'
}

/** The name of a page holding a note about an entry: "Mara Venn: What would Mara do if Tobin lied to her". */
export function notePageName(entryName: string, question: string): string {
  const name = entryName.trim()
  return `${name}: ${noteName(question, Math.max(30, 80 - name.length))}`
}

/** The description a change sets; null when it sets none. */
function descriptionOf(c: Change): string | null {
  if (c.kind === 'full') return c.payload.description ?? ''
  if (c.kind === 'update' && c.payload.description !== undefined) return c.payload.description
  return null
}

/** The change as it is, with another description. */
function withDescription(c: Change, description: string): ChangeInput {
  const at = { entryId: c.entryId, anchor: c.anchor, storyId: c.storyId, sceneId: c.sceneId }
  if (c.kind === 'full') return { ...at, kind: 'full', payload: { ...c.payload, description } }
  if (c.kind === 'update') return { ...at, kind: 'update', payload: { ...c.payload, description } }
  throw new UserError('That change has no description to add a note to.')
}

/**
 * The change that sets the entry's description where the memory is read (the last one on its line), or
 * null when the entry's own description is what counts there.
 */
export function descriptionSource(m: MemoryAt, entryId: ID): Change | null {
  const ix = indexChanges(m.data.changes)
  const lists: (Change[] | undefined)[] = [ix.baseline]
  for (const step of m.line.steps) {
    if (step.type === 'start-changes') lists.push(ix.byStory.get(step.storyId))
    else if (step.type === 'scene') lists.push(ix.byScene.get(step.sceneId))
  }
  let last: Change | null = null
  for (const list of lists) for (const c of list ?? []) if (c.entryId === entryId && descriptionOf(c) !== null) last = c
  return last
}

/** The story a change is pinned in (a scene's story as it is now); null for one from before any story. */
function storyOfChange(shape: WorldShape, c: Change): ID | null {
  if (c.anchor === 'baseline') return null
  if (c.anchor === 'scene' && c.sceneId) {
    const s = shape.stories.find((x) => x.chapters.some((ch) => ch.scenes.some((sc) => sc.id === c.sceneId)))
    if (s) return s.id
  }
  return c.storyId
}

/** Where a change counts from, in plain words: "the start of Young Mara", "Book 2, Ch 3, Sc 1". */
function placeOf(shape: WorldShape, c: Change): string | null {
  const story = storyOfChange(shape, c)
  if (!story) return null
  if (c.anchor === 'scene' && c.sceneId) return labeler(shape)({ storyId: story, sceneId: c.sceneId })
  return `the start of ${shape.stories.find((s) => s.id === story)?.title ?? ''}`
}

/** The stories an entry first exists in (null for the beginning of the world). */
function homesOf(db: DB, shape: WorldShape, entryId: ID): (ID | null)[] {
  const storyOf = new Map<ID, ID>()
  for (const s of shape.stories) for (const c of s.chapters) for (const sc of c.scenes) storyOf.set(sc.id, s.id)
  return mem.listExistsPoints(db, entryId).map((p) => (p.kind === 'scene' && p.sceneId ? (storyOf.get(p.sceneId) ?? p.storyId) : p.storyId))
}

/** True when the entry exists only in stories on this story's way that stand alone with it, so its own description reaches no other story. */
function onlyAlongHere(db: DB, shape: WorldShape, entryId: ID, m: MemoryAt): boolean {
  const walk = new Set(m.line.segments.map((s) => s.storyId))
  const homes = homesOf(db, shape, entryId)
  return homes.length > 0 && homes.every((h) => !!h && walk.has(h) && standsAlone(shape, h))
}

/** A new page in Lore holding the note, first existing where Adam is (in an own version of events, there alone). */
function newPage(db: DB, name: string, text: string, story: StoryNode | null, onlyIn: string | null): SavedNote {
  const e = repo.createEntry(db, 'lore', { name, description: text, originStoryId: story?.id ?? null })
  return { entryId: e.id, kind: e.kind, name: e.name, created: true, onlyIn, asOf: null, undo: { kind: 'created', entryId: e.id } }
}

/** The note at the end of the entry's own description, as typed by Adam. */
function addToEntry(db: DB, before: Entry, text: string, onlyIn: string | null): SavedNote {
  const after = repo.updateEntry(db, before.id, { description: withNote(before.description, text) }, { origin: 'adam' })
  return {
    entryId: after.id,
    kind: after.kind,
    name: after.name,
    created: false,
    onlyIn,
    asOf: null,
    undo: {
      kind: 'added',
      entryId: before.id,
      text,
      before: before.description,
      origin: before.fieldOrigins.description ?? null,
      byHand: before.byHand
    }
  }
}

/** Thrown inside a savepoint to take an edit back when the note wouldn't show where Adam is. */
const NOT_THERE = new Error('The note would not show there')

/**
 * The note at the end of the description a change sets, which becomes Adam's (as his own edit of a change
 * makes it). Null, with nothing changed, when it wouldn't show where Adam is after all: where a side story
 * and its host clash, the memory may keep an earlier description.
 */
function addToChange(db: DB, entry: Entry, c: Change, text: string, from: AskedFrom, m: MemoryAt, onlyIn: string | null): SavedNote | null {
  const before = descriptionOf(c) ?? ''
  const there = (m.state.entries.get(entry.id) ?? m.state.absent.get(entry.id))?.description ?? before
  const edit = db.transaction((): void => {
    mem.replaceChange(db, c.id, { ...withDescription(c, withNote(before, text)), origin: 'adam' })
    const now = memoryAt(db, from.at, m.shape, loadMemoryData(db))
    if ((now.state.entries.get(entry.id) ?? now.state.absent.get(entry.id))?.description !== withNote(there, text)) throw NOT_THERE
  })
  try {
    edit()
  } catch (e) {
    if (e === NOT_THERE) return null
    throw e
  }
  return {
    entryId: entry.id,
    kind: entry.kind,
    name: entry.name,
    created: false,
    onlyIn,
    asOf: placeOf(m.shape, c),
    undo: { kind: 'changed', entryId: entry.id, changeId: c.id, text, before, origin: c.origin }
  }
}

export function saveNote(db: DB, input: SaveNoteInput): SavedNote {
  const text = noteText(String(input.text ?? ''))
  if (!text) throw new UserError('There are no words to save. Save the whole answer, or select some of it first.')
  if (text.length > NOTE_LIMIT) throw new UserError('That is too long to save as one note. Select the part worth keeping, then save that.')
  const shape = loadShape(db)
  const from = askedFrom(shape, input.storyId ?? null, input.sceneId ?? null)
  const story = from?.story ?? null
  const alone = !!story && standsAlone(shape, story.id)
  const onlyIn = alone ? story.title : null

  return db.transaction((): SavedNote => {
    // About nothing in the memory yet: a new note in the world, first existing where Adam is.
    if (!input.entryId) return newPage(db, noteName(input.question ?? ''), text, story, onlyIn)
    const entry = repo.getEntry(db, input.entryId)
    // No story open: the world as it was set up, which is the entry's own description.
    if (!from) return addToEntry(db, entry, text, null)
    const m = memoryAt(db, from.at, shape, loadMemoryData(db))
    const source = descriptionSource(m, entry.id)
    if (!source) {
      if (!alone || onlyAlongHere(db, shape, entry.id, m)) return addToEntry(db, entry, text, onlyIn)
    } else {
      const home = storyOfChange(shape, source)
      if (!alone || (!!home && standsAlone(shape, home))) {
        const saved = addToChange(db, entry, source, text, from, m, onlyIn)
        if (saved) return saved
      }
    }
    // Its description here also counts in other stories (or wouldn't take the note): a page of its own here.
    return newPage(db, notePageName(entry.name, input.question ?? ''), text, story, onlyIn)
  })()
}

/** Takes a saved note back out. Words Adam has added since are kept. */
export function undoNote(db: DB, undo: NoteUndo): void {
  db.transaction(() => {
    switch (undo.kind) {
      case 'created':
        repo.deleteEntry(db, undo.entryId)
        return
      case 'added': {
        const e = repo.getEntry(db, undo.entryId)
        if (e.description === withNote(undo.before, undo.text)) {
          // Just as it was saved: the description, who it came from and whether the page was touched by hand go back.
          restoreProfile(db, e.id, { description: undo.before }, { description: undo.origin })
          if (!undo.byHand) setByHand(db, e.id, false)
          return
        }
        // Edited since: only the note's own words come out.
        const rest = withoutNote(e.description, undo.text)
        if (rest === null) throw changedSince(e.name)
        repo.updateEntry(db, e.id, { description: rest })
        return
      }
      case 'changed': {
        const e = repo.getEntry(db, undo.entryId)
        let c: Change
        try {
          c = mem.getChange(db, undo.changeId)
        } catch {
          throw changedSince(e.name)
        }
        const now = descriptionOf(c)
        if (now === withNote(undo.before, undo.text)) {
          // Just as it was saved: the description and who it came from go back.
          mem.replaceChange(db, c.id, { ...withDescription(c, undo.before), origin: undo.origin })
          return
        }
        const rest = now === null ? null : withoutNote(now, undo.text)
        if (rest === null) throw changedSince(e.name)
        mem.replaceChange(db, c.id, { ...withDescription(c, rest), origin: c.origin })
        return
      }
    }
  })()
}

const changedSince = (name: string): UserError =>
  new UserError(`${name} has been changed since, so the note couldn’t be taken out here. Open the page to take it out.`)
