// What the checks found in earlier scenes and Adam settled (fix 7 of the long story memory research, "Remember what the
// checks found", 2026-10-15). Two kinds of lesson, both read from the `issues` rows the checks already keep (no new
// store, no migration):
//   slips  a finding that was put right in the text: by Adam (Fix the text, Ask), by the chapter writer or by check and
//          repair as a draft landed. The writer of a later scene with the same people is warned not to make it again
//          ("Must stay true", ai/mustStay.ts), as ConWriter feeds a model's known failures back into its prompts.
//   meant  a finding Adam ignored (he said it is intended). The same thing in the same scene is never raised again
//          (db/checks.ts sameThing); a check of a later scene with the same people is told about it, so it doesn't
//          raise it there either (checks/context.ts).
// Slips only about facts, who knows what and the timeline: style and voice are not facts, continuity (clothes, who
// holds what) is about one moment, and a slip settled by Update the memory (the text was right) is no slip. A slip about
// who knows what or the timeline is about its moment too, so only the last RECENT_SCENES scenes' count; a fact (a scar,
// eye colour, who is dead) holds however long ago it was put right.
// What Adam meant may also be about a character's voice or the style (2026-10-16: an ignored voice finding came back in
// every later scene): a voice finding about its character however long ago, as a fact; a style finding from the last
// RECENT_SCENES scenes, about its character, or about the scene's telling when it names no one. What the chapter writer
// set aside (`setAsideBy`) is its own call, never what Adam meant.

import type Database from 'better-sqlite3'
import type { IssueKind } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import * as cdb from '../db/checks'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import { loadShapeSafe } from '../keeper/places'
import { plain } from '../keeper/text'

type DB = Database.Database
type Row = Record<string, unknown>

/** The kinds of finding that are lessons. */
export const LESSON_KINDS: IssueKind[] = ['fact', 'knowledge', 'timeline']
/** The kinds that are lessons only as what Adam meant (2026-10-16): how someone speaks, and how the story is told. */
export const MEANT_ONLY_KINDS: IssueKind[] = ['voice', 'style']
/** How many scenes back a slip or a meant finding about who knows what, the timeline or the style still counts. */
export const RECENT_SCENES = 6
/** Kinds that hold however long ago they were settled: a fact, and how a character speaks. */
const LASTING: IssueKind[] = ['fact', 'voice']

/** One finding settled in an earlier scene. */
export interface Lesson {
  /** The finding's sentence ("Mara's eyes are blue in the memory, but green here."). */
  text: string
  /** Where it was found, in plain words ("Book 1, Ch 2, Sc 3"). */
  where: string
  /** The codex entries it is about. */
  entryIds: ID[]
  kind: IssueKind
  /** How many scenes back it was found (1: the scene before). */
  back: number
}

export interface Lessons {
  /** Put right in the text, newest first. */
  slips: Lesson[]
  /** Said by Adam to be meant, newest first. */
  meant: Lesson[]
}

const NONE: Lessons = { slips: [], meant: [] }

/** The codex entries an issue row is about: its entry, and the entries among its sources. */
export function entriesOf(p: cdb.IssuePayload): ID[] {
  const ids = new Set<ID>()
  if (p.entryId) ids.add(p.entryId)
  for (const s of p.sources ?? []) if (s && (s.kind === 'entry' || s.kind === 'thread')) ids.add(s.entryId)
  return [...ids]
}

/**
 * The lessons in these rows, newest first. `order` is the scenes before this one, oldest first; `where` says where a
 * scene is. `settledByMemory` tells a row fixed before `fixedBy` was kept whose memory took the text's value since.
 * One lesson for the same entry and field, or the same words: the newest.
 */
export function lessonsFrom(
  rows: Row[],
  order: ID[],
  where: (sceneId: ID) => string,
  settledByMemory: (p: cdb.IssuePayload) => boolean = () => false
): Lessons {
  const at = new Map(order.map((id, i) => [id, order.length - i] as const))
  const out: Lessons = { slips: [], meant: [] }
  const seen = { slips: new Set<string>(), meant: new Set<string>() }
  const ranked = rows
    .map((r) => ({ r, back: at.get(r.scene_id as ID) ?? 0 }))
    .filter((x) => x.back > 0)
    .sort((a, b) => a.back - b.back || String(b.r.updated_at).localeCompare(String(a.r.updated_at)))
  for (const { r, back } of ranked) {
    const kind = r.kind as IssueKind
    const list = r.status === 'fixed' ? 'slips' : r.status === 'ignored' ? 'meant' : null
    if (!list) continue
    if (!LESSON_KINDS.includes(kind) && !(list === 'meant' && MEANT_ONLY_KINDS.includes(kind))) continue
    if (!LASTING.includes(kind) && back > RECENT_SCENES) continue
    const p = cdb.payloadOf(r)
    // Something a scene's contract said must change and the draft didn't show yet (fix 13) is about that draft's plan,
    // never a fact for later scenes.
    if (p.contract?.part === 'change') continue
    // Set aside by the chapter writer, not by Adam: never what he meant.
    if (list === 'meant' && p.setAsideBy) continue
    const text = String(r.message ?? '').trim()
    const entryIds = entriesOf(p)
    // A style finding may be about the telling and no one in it; everything else is about someone or something.
    if (!text || (!entryIds.length && kind !== 'style')) continue
    if (list === 'slips' && (p.fixedBy === 'memory' || settledByMemory(p))) continue
    const keys = [plain(text), ...(p.entryId && p.field ? [`${p.entryId}|${p.field}`] : [])]
    if (keys.some((k) => seen[list].has(k))) continue
    for (const k of keys) seen[list].add(k)
    out[list].push({ text, where: where(r.scene_id as ID), entryIds, kind, back })
  }
  return out
}

/**
 * The lessons from every scene before this one on its line (its own story's earlier scenes, the stories it follows on
 * from, side stories added whole). Never throws: none when the stories can't be read.
 */
export function lessonsBefore(db: DB, sceneId: ID): Lessons {
  const shape = loadShapeSafe(db)
  const story = shape ? storyOfScene(shape, sceneId) : null
  if (!shape || !story) return NONE
  try {
    const steps = buildLine(shape, { storyId: story.id, before: sceneId }).steps.filter(
      (s): s is Extract<typeof s, { type: 'scene' }> => s.type === 'scene'
    )
    const rows = cdb.settledRows(
      db,
      steps.map((s) => s.sceneId),
      [...LESSON_KINDS, ...MEANT_ONLY_KINDS]
    )
    if (!rows.length) return NONE
    const label = labeler(shape)
    const storyOf = new Map(steps.map((s) => [s.sceneId, s.storyId] as const))
    const entries = cdb.entryNamesFor(db, rows)
    // Fixed before `fixedBy` was kept: settled by the memory when the memory's value now is the text's.
    const settledByMemory = (p: cdb.IssuePayload): boolean => {
      const e = p.entryId ? entries.get(p.entryId) : undefined
      return !!(e && p.field && p.text?.trim() && plain(e.value(p.field)) === plain(p.text))
    }
    return lessonsFrom(
      rows,
      steps.map((s) => s.sceneId),
      (id) => label({ storyId: storyOf.get(id) ?? null, sceneId: id }),
      settledByMemory
    )
  } catch (e) {
    console.warn('Could not read what the checks found in earlier scenes', e)
    return NONE
  }
}

/** A lesson as a line: where, then its sentence. */
export const lessonLine = (l: Lesson, where = l.where): string => `${where ? `In ${where}: ` : ''}${l.text.replace(/\s+/g, ' ')}`
