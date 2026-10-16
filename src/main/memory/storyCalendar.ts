// The story calendar, read from the world (long story memory fix 11; the rules are in memory/calendar.ts). Each story's
// calendar is worked out from its line (every scene it follows on from, and the side stories it knows of, in the walk's
// order) and the scene cards' When, and kept until anything is written to the world (`changesMade`, as the world views
// keep what they read), so the stage tracker can ask about every scene on a line without reading it all again.
//
// For the writer's briefing (`sceneCalendar`, ai/gather.ts), the stage tracker's carry rules (continuity/tracker.ts
// startFrom, ai/context.ts stageReach and timeCarries), the screen (`storyDateViews`: the scene card and the story
// board), and rule-based checks to come (fix 8): `storyDateAt`, `elapsedBetweenScenes`, `ageAt` and `scenesGoingBack`.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { EntryState, ID } from '@shared/types'
import type { SceneDateView } from '@shared/contracts/worldViews'
import { chapterChoice } from './promises'
import { buildLine, labeler, storyOfScene } from './line'
import { sceneMemory } from './scene'
import type { Line, WorldShape } from './types'
import * as mem from '../db/memory'
import { changesMade, sceneCards, storyGaps } from '../db/worldViews'
import { walkOf } from '../worldViews/walk'
import { sideStart } from '../worldViews/timeline'
import type { WhenStory } from '../worldViews/when'
import {
  ageFrom,
  buildCalendar,
  dateLabel,
  dateOfText,
  elapsedBetween,
  goingBack,
  readAge,
  storyDayWords,
  withCues,
  type AgeHere,
  type Calendar,
  type CalendarItem,
  type Elapsed,
  type GoingBack,
  type Landmark,
  type SceneCalendar,
  type StoryDate
} from './calendar'

export type { AgeHere, Landmark, SceneCalendar } from './calendar'

type DB = Database.Database

/** A story's calendar, with where each scene on its line is. */
export interface StoryCalendar extends Calendar {
  storyId: ID
  /** Each scene on the line: its story and chapter. */
  where: Map<ID, { storyId: ID; chapterId: ID }>
  /** Each scene on the line, by where it is in plain words ("Book 1, Ch 3, Sc 2"), as the memory says where a change was. */
  byLabel: Map<string, ID>
  shape: WorldShape
}

interface Read {
  changed: number
  shape: WorldShape
  byStory: Map<ID, StoryCalendar>
}

const reads = new WeakMap<DB, Read>()

function readWorld(db: DB): Read {
  const changed = changesMade(db)
  let r = reads.get(db)
  if (!r || r.changed !== changed) {
    r = { changed, shape: mem.loadShape(db), byStory: new Map() }
    reads.set(db, r)
  }
  return r
}

/**
 * The items and story links to place for a line, as the timeline reads them (worldViews/timeline.ts, scenes only): a
 * side story leans on its host where it starts, a book that follows on on the book before as it stood where this one
 * begins (nothing across a time gap), and a book that follows on may count its days afresh.
 */
export function calendarItems(
  shape: WorldShape,
  line: Line,
  whenOf: (sceneId: ID) => string,
  gaps: ReadonlyMap<ID, string>
): { items: CalendarItem[]; stories: Map<ID, WhenStory> } {
  const w = walkOf(line)
  const nodes = new Map(shape.stories.map((s) => [s.id, s]))
  const items: CalendarItem[] = []
  const stories = new Map<ID, WhenStory>()
  // How many scenes had been read once each step had, for where a side story starts in its host.
  const readBy: number[] = []
  line.steps.forEach((step, i) => {
    if (step.type === 'start') {
      const node = nodes.get(step.storyId)
      const from = node?.startStoryId
      const side = node?.kind === 'side'
      const at = side && node && from ? sideStart(w, node, from) : undefined
      const leans = !!from && w.start.has(from) && (side || !gaps.get(step.storyId))
      stories.set(step.storyId, {
        from: leans ? { story: from!, at: at === undefined ? items.length : readBy[at] } : null,
        fresh: !!from && !side
      })
    } else if (step.type === 'scene') items.push({ id: step.sceneId, story: step.storyId, when: whenOf(step.sceneId) })
    readBy[i] = items.length
  })
  return { items, stories }
}

/** A story's calendar, through its end; null when the story is gone. Kept until the world changes. */
export function storyCalendar(db: DB, storyId: ID): StoryCalendar | null {
  const r = readWorld(db)
  const kept = r.byStory.get(storyId)
  if (kept) return kept
  if (!r.shape.stories.some((s) => s.id === storyId)) return null
  const line = buildLine(r.shape, { storyId, through: 'end' })
  const cards = sceneCards(db)
  const { items, stories } = calendarItems(r.shape, line, (id) => cards.get(id)?.when ?? '', storyGaps(db))
  const label = labeler(r.shape)
  const where = new Map<ID, { storyId: ID; chapterId: ID }>()
  const byLabel = new Map<string, ID>()
  for (const step of line.steps) {
    if (step.type !== 'scene') continue
    where.set(step.sceneId, { storyId: step.storyId, chapterId: step.chapterId })
    byLabel.set(label({ storyId: step.storyId, sceneId: step.sceneId }), step.sceneId)
  }
  const cal: StoryCalendar = { ...buildCalendar(items, stories), storyId, where, byLabel, shape: r.shape }
  r.byStory.set(storyId, cal)
  return cal
}

/** The calendar a scene is read on: its own story's. */
export function calendarOfScene(db: DB, sceneId: ID): StoryCalendar | null {
  const story = storyOfScene(readWorld(db).shape, sceneId)
  return story ? storyCalendar(db, story.id) : null
}

/**
 * A scene's in-story date, as far as it is known (memory/calendar.ts StoryDate); null when the scene is gone. With
 * `cues` (continuity/tracker.ts timeCues), a scene with no When takes its time of day from the memory's reading of its words.
 */
export function storyDateAt(db: DB, sceneId: ID, cues?: ReadonlyMap<ID, string>): StoryDate | null {
  const cal = calendarOfScene(db, sceneId)
  if (!cal) return null
  return (cues ? withCues(cal, cues) : cal).dates.get(sceneId) ?? null
}

/** How long after scene `a` scene `b` is (on `b`'s story's calendar); null when it can't be told. */
export function elapsedBetweenScenes(db: DB, a: ID, b: ID): Elapsed | null {
  const cal = calendarOfScene(db, b)
  return cal ? elapsedBetween(cal.dates.get(a), cal.dates.get(b)) : null
}

/** The scenes of a story whose date goes back without saying so (memory/calendar.ts goingBack), in reading order. */
export function scenesGoingBack(db: DB, storyId: ID): GoingBack[] {
  const cal = storyCalendar(db, storyId)
  if (!cal) return []
  const stories = new Map([...cal.where].map(([id, w]) => [id, w.storyId] as const))
  return goingBack(cal, stories).filter((b) => cal.where.get(b.sceneId)?.storyId === storyId)
}

// ---------- Ages ----------

/** The first day its calendar names: where "at the story's start" is. */
function startOf(cal: Calendar, here: StoryDate): StoryDate | null {
  for (const id of cal.order) {
    const d = cal.dates.get(id)
    if (d && d.cal === here.cal && d.axis !== null) return d
  }
  return null
}

/**
 * How old a character is at a scene, from their "Age or birth date" field as of that scene (`entry`) and where the
 * memory says it was set (`changedWhere`): a birth date, an age at a date it names, or a bare age as of the scene it was
 * set in (the story's start for the starting setup). Null when the field says nothing usable, or the dates can't be
 * compared.
 */
export function ageHere(cal: StoryCalendar, entry: Pick<EntryState, 'fields' | 'changedWhere'>, sceneId: ID): AgeHere | null {
  const here = cal.dates.get(sceneId)
  const fact = readAge(entry.fields?.age)
  if (!here || !fact) return null
  if (fact.kind === 'born') {
    const born = dateOfText(cal, fact.when, null)
    const age = born && ageFrom({ born }, here)
    return age ? { age, basis: `born ${fact.when}`, born: true } : null
  }
  let then: StoryDate | null = null
  let basis = ''
  if (fact.at) {
    then = dateOfText(cal, fact.at, sceneId)
    basis = `${fact.years} ${/^(?:day|the\s+\d|\d{1,2}\s)/i.test(fact.at) ? 'on' : 'in'} ${fact.at}`
  } else {
    const set = entry.changedWhere?.age
    const setAt = set && !fact.start ? cal.byLabel.get(set) : undefined
    if (setAt) {
      then = cal.dates.get(setAt) ?? null
      basis = `${fact.years} as of ${set}`
    } else if (!set || fact.start || /^the start of /.test(set)) {
      then = startOf(cal, here)
      basis = `${fact.years} at the story's start`
    }
  }
  const age = then && ageFrom({ years: fact.years, then }, here)
  return age ? { age, basis, born: false, given: fact.years } : null
}

/** How old a character is as a scene begins (ageHere), as the memory has them there. Null when it can't be told. */
export function ageAt(db: DB, characterId: ID, sceneId: ID): AgeHere | null {
  const cal = calendarOfScene(db, sceneId)
  if (!cal?.dates.has(sceneId)) return null
  const e = sceneMemory(db, sceneId).entries.find((x) => x.id === characterId && x.kind === 'character')
  return e ? ageHere(cal, e, sceneId) : null
}

// ---------- For the writer's briefing ----------

/** The most landmarks worked out for a scene (the briefing tells fewer on small models). */
export const LANDMARKS_MOST = 4

/**
 * The story calendar for a scene's briefing: its date, the previous scene's, earlier days worth counting from (dated
 * events that exist here, then the start of each chapter of its story so far), and the ages of those on its card. Null
 * when the scene is gone.
 */
export function sceneCalendar(
  db: DB,
  sceneId: ID,
  memory: { previous: { sceneId: ID } | null; entries: EntryState[] },
  card: { povId: ID | null; presentIds: ID[] }
): SceneCalendar | null {
  const cal = calendarOfScene(db, sceneId)
  const here = cal?.dates.get(sceneId)
  if (!cal || !here) return null
  const previous = memory.previous ? (cal.dates.get(memory.previous.sceneId) ?? null) : null
  const ahead = (d: StoryDate | null | undefined): boolean => {
    const e = elapsedBetween(d, here)
    return !!e && e.days > 0
  }
  const same = (d: StoryDate): boolean => !!previous && elapsedBetween(d, previous)?.days === 0
  // Dated events that exist here, the latest first.
  const events: Landmark[] = []
  for (const e of memory.entries) {
    if (e.kind !== 'event' || !e.fields?.when?.trim()) continue
    const date = dateOfText(cal, e.fields.when, sceneId)
    if (date && ahead(date) && !same(date)) events.push({ name: e.name.trim().replace(/^The\b/, 'the'), date })
  }
  const latest = (a: Landmark, b: Landmark): number => elapsedBetween(a.date, b.date)?.days ?? 0
  events.sort((a, b) => latest(a, b))
  // The start of each chapter of this story so far, the latest first: its first scene, when that names its day.
  const chapters: Landmark[] = []
  const at = cal.where.get(sceneId)
  const story = at ? cal.shape.stories.find((s) => s.id === at.storyId) : undefined
  const seen = new Set<ID>()
  for (const id of cal.order) {
    if (id === sceneId) break
    const w = cal.where.get(id)
    if (!w || w.storyId !== at?.storyId || seen.has(w.chapterId)) continue
    seen.add(w.chapterId)
    const d = cal.dates.get(id)
    if (!d || d.axis === null || !ahead(d) || same(d) || id === memory.previous?.sceneId) continue
    const no = (story?.chapters.findIndex((c) => c.id === w.chapterId) ?? -1) + 1
    if (no > 0) chapters.unshift({ name: `the start of ${chapterChoice(no, story!.chapters[no - 1].title).replace(' · ', ': ')}`, date: d })
  }
  const landmarks = [...events, ...chapters].slice(0, LANDMARKS_MOST)
  // Ages of those on the card.
  const byId = new Map(memory.entries.map((e) => [e.id, e]))
  const ages: SceneCalendar['ages'] = []
  for (const id of [...new Set([card.povId, ...card.presentIds])]) {
    const e = id ? byId.get(id) : undefined
    if (!e || e.kind !== 'character') continue
    const age = ageHere(cal, e, sceneId)
    if (age) ages.push({ name: e.name.trim() || 'Someone', age })
  }
  return { here, previous, landmarks, ages }
}

// ---------- On the screen ----------

/**
 * What the scene card and the story board say of a scene's date (`cues`: a time of day the memory read from the words of
 * a scene with no When). The note under When says how the app read it when that adds to Adam's words, or gently that
 * it couldn't tell, short enough for one line; `detail` says it in full (on hover). '' leaves the usual hint (a When
 * such as "Day 1, dusk" reads as itself).
 */
export function dateView(cal: Calendar, sceneId: ID, back: ReadonlyMap<ID, GoingBack>): SceneDateView {
  const d = cal.dates.get(sceneId)
  if (!d) return { when: '', label: '', day: '', note: '', detail: '' }
  const label = dateLabel(d)
  // The day alone, beside a When that leans on the scenes before ("The next morning" is Day 4).
  const day = d.date || (d.day !== null && d.day >= 1 ? `Day ${d.day} of the story` : '')
  const view = (note: string, detail = note): SceneDateView => ({ when: d.when, label, day: d.leans ? day : '', note, detail })
  const went = back.get(sceneId)
  if (went) {
    const before = dateLabel(cal.dates.get(went.beforeId))
    return view(
      'Earlier than the scene before. A flashback?',
      `This comes before the scene before it${before ? ` (${before})` : ''}. If it’s a flashback, start the When with “Flashback” and AI Write will know.`
    )
  }
  switch (d.reading) {
    case 'empty':
      return view(d.timeFrom === 'memory' && d.time ? `No date yet. By the scene’s end it’s ${d.time}.` : '')
    case 'unclear':
      return view('AI Write can’t read a date in this.', 'AI Write can’t tell the date from this, so the AI gets your words as they are.')
    case 'unanchored':
      return view('Nothing dated before this to count on from.', 'No scene before this one names its day, so AI Write can’t work out which day this is.')
    case 'vague':
      return view(
        'Doesn’t say how many days, so the count stops.',
        'AI Write can’t tell how many days that is, so it doesn’t count days on from here until a scene names its own.'
      )
    default:
      return view(day && (d.leans || storyDayWords(d)) ? `Reads as ${label}.` : '')
  }
}

/** Every scene of a story's date on the screen (dateView), by scene id. */
export function storyDateViews(db: DB, storyId: ID, cues?: ReadonlyMap<ID, string>): Record<ID, SceneDateView> {
  const kept = storyCalendar(db, storyId)
  if (!kept) return {}
  const cal = cues ? withCues(kept, cues) : kept
  const stories = new Map([...kept.where].map(([id, w]) => [id, w.storyId] as const))
  const back = new Map(goingBack(cal, stories).map((b) => [b.sceneId, b]))
  const out: Record<ID, SceneDateView> = {}
  for (const [id, w] of kept.where) if (w.storyId === storyId) out[id] = dateView(cal, id, back)
  return out
}
