// An end-of-chapter snapshot and how it is said (long story memory fix 15, 2026-10-16): what changed in a chapter and
// how things stand at its end, from the story record (worked out in memory/chapterRecord.ts, kept in meta by
// db/snapshots.ts). Entries are kept by id and named when it is said, so a rename never makes a snapshot out of date.
// The chapter, story and series roll-ups (keeper/summaries.ts) and the writer's timeline (ai/timeline.ts) say it this
// way. Pure.

import type { ID, KnowHow } from '@shared/types'
import { howWords } from '@shared/knowWords'
import { dateLabel, elapsedBetween, elapsedWords, type StoryDate } from './calendar'

/** Raised when what a snapshot holds, or how it is worked out, changes: every kept snapshot is worked out again. */
export const SNAPSHOT_VERSION = 1

/** The most of each kind a snapshot keeps. */
export const SNAPSHOT_MOST = { changed: 12, learned: 6, threads: 6, people: 10, open: 8, holds: 4, looks: 3, believes: 2 }
/** The longest note or fact a snapshot keeps, in characters. */
const LONGEST = 160

export type ThreadStep = 'set up' | 'moved on' | 'paid off'

export interface ChapterSnapshot {
  v: number
  chapterId: ID
  storyId: ID
  /** The chapter's last scene with words: how things stand is as of its end. */
  sceneId: ID
  /**
   * When the chapter runs on the story calendar ("Day 3, dusk to Day 5, morning (2 days)"); '' when the cards don't say.
   * Kept for the record, but never told to a roll-up nor part of what a chapter summary is tied to (review, 2026-10-16):
   * an early When edit re-dates every later chapter, and that should cost no AI calls. The timeline shows `days`.
   */
  span: string
  /** The same, by day only ("Day 3 to Day 5"), for the writer's timeline. */
  days: string
  /** What changed in its scenes, in order: whose, the note, and the scene (its number in the chapter). `with`: a tie to them. */
  changed: { who: ID; note: string; sc: number; with?: ID }[]
  /** Who learned what in it, still known at its end, by fact and scene. `wrong`: they came to believe it, and it isn't true. */
  learned: { who: ID[]; fact: string; sc: number; how?: KnowHow; from?: ID; wrong?: true }[]
  /** Plot threads it set up, moved on or paid off. */
  threads: { thread: ID; step: ThreadStep; sc: number }[]
  /** How each character in it stands at its end (only those with something to say). */
  people: { who: ID; dead?: true; at?: ID; atSc?: number; looks?: string[]; holds?: ID[]; believes?: string[] }[]
  /** Plot threads still open at its end: those it touched first. */
  open: ID[]
}

export const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
export const clip = (s: string, most = LONGEST): string => {
  const t = clean(s).replace(/[.]+$/, '')
  return t.length > most ? `${t.slice(0, most - 1).trimEnd()}…` : t
}

/** A day as the span says it: the date, else the day of the story. */
const dayOf = (d: StoryDate): string => d.date || (d.day !== null && d.day >= 1 ? `Day ${d.day} of the story` : '')

/** When the scenes run on the calendar, from the first dated scene to the last (flashbacks left out). */
export function spanOf(dates: (StoryDate | null | undefined)[]): { span: string; days: string } {
  const dated = dates.filter((d): d is StoryDate => !!d && !d.back && !!dayOf(d))
  if (!dated.length) return { span: '', days: '' }
  const first = dated[0]
  const last = dated[dated.length - 1]
  if (first === last || first.id === last.id) return { span: dateLabel(first, ', '), days: dayOf(first) }
  const gap = elapsedBetween(first, last)
  const sameDay = dayOf(first) === dayOf(last)
  return {
    span: `${dateLabel(first, ', ')} to ${dateLabel(last, ', ')}${gap && gap.days >= 0 ? ` (${elapsedWords(gap)})` : ''}`,
    days: sameDay ? dayOf(first) : `${dayOf(first)} to ${dayOf(last)}`
  }
}

// ---------- Saying it ----------

/** A name for an entry id as of now; null (or '') leaves out what it would name. */
export type NameOf = (id: ID) => string | null | undefined

const joinAnd = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
const namesOf = (ids: ID[], nameOf: NameOf, most = 3): string => {
  const names = ids.map((id) => clean(nameOf(id))).filter(Boolean)
  return names.length > most + 1 ? `${names.slice(0, most).join(', ')} and ${names.length - most} more` : joinAnd(names)
}

/** One thing learned, in words: "Tobin and Ash learned: Mara is the heir (saw it, scene 3)". */
function learnedLine(l: ChapterSnapshot['learned'][number], nameOf: NameOf): string {
  const who = namesOf(l.who, nameOf)
  if (!who) return ''
  const how = howWords({ how: l.how, from: l.from }, nameOf)
  return `${who} ${l.wrong ? 'came to believe wrongly' : 'learned'}: ${l.fact} (${how ? `${how}, ` : ''}scene ${l.sc})`
}

/**
 * What changed in the chapter, from the record, as lines (no "- "): each change, what was learned, threads. Not when it
 * runs (the calendar is the timeline's, with no AI: see `span`).
 */
export function changedLines(s: ChapterSnapshot, nameOf: NameOf): string[] {
  const out: string[] = []
  for (const c of s.changed) {
    const who = clean(nameOf(c.who))
    if (!who) continue
    if (c.with) {
      const other = clean(nameOf(c.with))
      if (other) out.push(`${who} and ${other}: ${c.note} (scene ${c.sc})`)
    } else out.push(`${who}: ${c.note} (scene ${c.sc})`)
  }
  for (const l of s.learned) {
    const line = learnedLine(l, nameOf)
    if (line) out.push(line)
  }
  for (const t of s.threads) {
    const name = clean(nameOf(t.thread))
    if (name) out.push(`Plot thread ${t.step}: ${name} (scene ${t.sc})`)
  }
  return out
}

/** How things stand at the end of the chapter, from the record, as lines (no "- "): each character, then the open threads. */
export function endLines(s: ChapterSnapshot, nameOf: NameOf): string[] {
  const out: string[] = []
  for (const p of s.people) {
    const who = clean(nameOf(p.who))
    if (!who) continue
    if (p.dead) {
      out.push(`${who}: dead`)
      continue
    }
    const bits: string[] = []
    const place = p.at ? clean(nameOf(p.at)) : ''
    if (place) bits.push(`last at ${place} (scene ${p.atSc})`)
    bits.push(...(p.looks ?? []))
    const holds = (p.holds ?? []).map((id) => clean(nameOf(id))).filter(Boolean)
    if (holds.length) bits.push(`has ${joinAnd(holds)}`)
    for (const b of p.believes ?? []) bits.push(`wrongly believes: ${b}`)
    if (bits.length) out.push(`${who}: ${bits.join('; ')}`)
  }
  const open = s.open.map((id) => clean(nameOf(id))).filter(Boolean)
  if (open.length) out.push(`Plot threads still open: ${open.join('; ')}`)
  return out
}

/**
 * A few of the chapter's facts for its line in the writer's timeline, where a 60-word summary may have lost them: who
 * learned what (or came to believe wrongly), then plot threads paid off and set up. At most `most`.
 */
export function timelineFacts(s: ChapterSnapshot, nameOf: NameOf, most = 2): string[] {
  const out: string[] = []
  for (const l of s.learned) {
    const who = namesOf(l.who, nameOf, 2)
    if (who) out.push(`${who} ${l.wrong ? 'came to believe wrongly' : 'learned'}: ${clip(l.fact, 100)}`)
  }
  for (const step of ['paid off', 'set up'] as const) {
    for (const t of s.threads.filter((x) => x.step === step)) {
      const name = clean(nameOf(t.thread))
      if (name) out.push(`${step === 'paid off' ? 'paid off' : 'set up'}: ${clip(name, 80)}`)
    }
  }
  return out.slice(0, most)
}

/**
 * The chapter's own record (what changed in it), for telling whether its summary is still made from what is true. Not
 * the days it runs: a When edit early on re-dates every later chapter, and that is the timeline's to show, with no AI.
 */
export const localPart = (s: ChapterSnapshot | null): string => (s ? JSON.stringify([s.changed, s.learned, s.threads]) : '')
/** How things stand at its end, for the story's roll-up and for whether the next chapter's snapshot is still true. */
export const endPart = (s: ChapterSnapshot | null): string => (s ? JSON.stringify([s.people, s.open]) : '')
