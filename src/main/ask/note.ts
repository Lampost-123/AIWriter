// Saving words from an answer to the memory as Adam's own note (spec, Ask the world: "Anything useful
// can be saved to the memory with one click, as Adam's own note"). The words go at the end of an
// entry's description, as his (so the memory keeper never changes them), or become a new note in the
// world (lore) when the answer is about nothing in the memory yet. In an own version of events, a note
// added to an entry that also lives outside it is kept for that story only (a start-of-story change),
// so it never reaches another story; a new note made there first exists in that story alone.
// Everything can be taken back out (the toast's Undo). No Electron imports.

import type Database from 'better-sqlite3'
import type { NoteUndo, SavedNote, SaveNoteInput } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { restoreProfile } from '../db/entryViews'
import { setByHand } from '../db/ask'
import { memoryAt } from '../memory/asOf'
import { loadMemoryData, loadShape } from '../memory/scene'
import type { WorldShape } from '../memory/types'
import { UserError } from '../util'
import { standsAlone } from './context'

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

/** The stories an entry first exists in (null for the beginning of the world). */
function homesOf(db: DB, shape: WorldShape, entryId: ID): (ID | null)[] {
  const storyOf = new Map<ID, ID>()
  for (const s of shape.stories) for (const c of s.chapters) for (const sc of c.scenes) storyOf.set(sc.id, s.id)
  return mem.listExistsPoints(db, entryId).map((p) => (p.kind === 'scene' && p.sceneId ? (storyOf.get(p.sceneId) ?? p.storyId) : p.storyId))
}

export function saveNote(db: DB, input: SaveNoteInput): SavedNote {
  const text = noteText(String(input.text ?? ''))
  if (!text) throw new UserError('There are no words to save. Save the whole answer, or select some of it first.')
  if (text.length > NOTE_LIMIT) throw new UserError('That is too long to save as one note. Select the part worth keeping, then save that.')
  const shape = loadShape(db)
  const story = input.storyId ? (shape.stories.find((s) => s.id === input.storyId) ?? null) : null

  return db.transaction((): SavedNote => {
    if (!input.entryId) {
      // About nothing in the memory yet: a new note in the world, first existing where Adam is.
      const e = repo.createEntry(db, 'lore', { name: noteName(input.question ?? ''), description: text, originStoryId: story?.id ?? null })
      return { entryId: e.id, kind: e.kind, name: e.name, created: true, onlyIn: null, undo: { kind: 'created', entryId: e.id } }
    }
    const before = repo.getEntry(db, input.entryId)
    if (story && standsAlone(shape, story.id) && !homesOf(db, shape, before.id).includes(story.id)) {
      // An own version of events: kept for this story only, from its start, so no other story sees it.
      const m = memoryAt(db, { kind: 'start', storyId: story.id }, shape, loadMemoryData(db))
      const there = m.state.entries.get(before.id) ?? m.state.absent.get(before.id)
      const change = mem.insertChange(db, {
        entryId: before.id,
        anchor: 'story-start',
        storyId: story.id,
        kind: 'update',
        payload: { note: '', description: withNote(there?.description ?? before.description, text) },
        origin: 'adam'
      })
      return {
        entryId: before.id,
        kind: before.kind,
        name: before.name,
        created: false,
        onlyIn: story.title,
        undo: { kind: 'change', entryId: before.id, changeId: change.id }
      }
    }
    const after = repo.updateEntry(db, before.id, { description: withNote(before.description, text) }, { origin: 'adam' })
    return {
      entryId: after.id,
      kind: after.kind,
      name: after.name,
      created: false,
      onlyIn: null,
      undo: {
        kind: 'added',
        entryId: before.id,
        text,
        before: before.description,
        origin: before.fieldOrigins.description ?? null,
        byHand: before.byHand
      }
    }
  })()
}

/** Takes a saved note back out. Words Adam has added since are kept. */
export function undoNote(db: DB, undo: NoteUndo): void {
  db.transaction(() => {
    switch (undo.kind) {
      case 'created':
        repo.deleteEntry(db, undo.entryId)
        return
      case 'change':
        mem.deleteChange(db, undo.changeId)
        return
      case 'added': {
        const e = repo.getEntry(db, undo.entryId)
        if (e.description === withNote(undo.before, undo.text)) {
          // Just as it was saved: the description, who it came from and whether the page was touched by hand go back.
          restoreProfile(db, e.id, { description: undo.before }, { description: undo.origin })
          if (!undo.byHand) setByHand(db, e.id, false)
          return
        }
        const at = e.description.lastIndexOf(undo.text)
        if (at < 0)
          throw new UserError(`${e.name} has been changed since, so the note couldn’t be taken out here. Open the page to take it out.`)
        // Edited since: only the note's own words come out.
        const rest = `${e.description.slice(0, at).trimEnd()}\n\n${e.description.slice(at + undo.text.length).trimStart()}`.trim()
        repo.updateEntry(db, e.id, { description: rest })
        return
      }
    }
  })()
}
