// What Adam has told the critic, and what it said before (the critic knows the story and remembers, 2026-10-16;
// contracts/critique.ts). All of it in the world's `meta`, no migration:
//   - what he did about each note (done, not needed, not for this story) is kept on the note, in the kept critique
//     (store.ts, `critique:<scope>:<id>`);
//   - notes he acted on or said aren't needed are carried from one critique of a scene or chapter to the next
//     (`Critique.earlier`, at most MOST_EARLIER), so a new critique never forgets them;
//   - what he said isn't for this story is kept for the whole story, `critique_wants:<story id>` (a JSON list of
//     CritiqueWant, newest first, at most MOST_WANTS), and goes with the story in purgeTrash.
// The critic is told them ("What the author has said he wants", and on a re-read "Your notes last time"), and a new note
// that goes against them is left out all the same (guardNotes): a note like one he set aside, or the opposite of one he
// acted on, on the words he put in. No Electron imports; the telling and the guard are pure.

import type Database from 'better-sqlite3'
import type { Critique, CritiqueNote, CritiqueScope, CritiqueTarget, CritiqueWant } from '@shared/contracts/critique'
import { CRITIQUE_CATEGORIES } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { getCritiqueWants, setCritiqueWants } from '../db/critiques'
import { plainQuote, quotesOverlap } from '../checks/quote'

type DB = Database.Database

/** The most kinds of note kept as not for a story. */
export const MOST_WANTS = 30
/** The most of them told to the critic (the newest). */
export const MOST_WANTS_TOLD = 12
/** The most notes carried from one critique of a scene or chapter to the next. */
export const MOST_EARLIER = 12
/** The most of each kind (not needed, acted on) told to the critic. */
export const MOST_SAID = 8

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim()
const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

// ---------- What isn't for this story ----------

const isWant = (v: unknown): v is CritiqueWant => {
  const w = v as CritiqueWant
  return !!w && typeof w === 'object' && typeof w.id === 'string' && typeof w.title === 'string' && typeof w.suggestion === 'string'
}

/** What Adam said isn't for the story, newest first; none when it can't be read. */
export function loadWants(db: DB, storyId: ID): CritiqueWant[] {
  try {
    const v = JSON.parse(getCritiqueWants(db, storyId) ?? '[]') as unknown
    return (Array.isArray(v) ? v : []).filter(isWant).map((w) => ({
      ...w,
      category: CRITIQUE_CATEGORIES.includes(w.category) ? w.category : 'other',
      at: typeof w.at === 'string' ? w.at : ''
    }))
  } catch {
    return []
  }
}

/** Keeps the list (no row for none). */
export function saveWants(db: DB, storyId: ID, wants: CritiqueWant[]): void {
  setCritiqueWants(db, storyId, wants.length ? JSON.stringify(wants.slice(0, MOST_WANTS)) : null)
}

/** The story a scene or chapter is in; null when it has gone. */
export function storyOfTarget(db: DB, target: CritiqueTarget): ID | null {
  try {
    return target.scope === 'scene' ? repo.sceneLocation(db, target.id).story.id : repo.getChapter(db, target.id).storyId
  } catch {
    return null
  }
}

/** A note as a kind of note not wanted in the story (the newest first; the same title again replaces the older one). */
export function addWant(wants: CritiqueWant[], note: CritiqueNote, from: CritiqueWant['from'], at: string, id: string): CritiqueWant[] {
  const want: CritiqueWant = { id, category: note.category, title: cap(clean(note.title), 120), suggestion: cap(clean(note.suggestion), 300), at, ...(from ? { from } : {}) }
  const same = (w: CritiqueWant): boolean => w.category === want.category && plainQuote(w.title) === plainQuote(want.title)
  return [want, ...wants.filter((w) => !same(w))].slice(0, MOST_WANTS)
}

/** The list without what was said on this note (it was brought back). */
export const withoutNote = (wants: CritiqueWant[], from: NonNullable<CritiqueWant['from']>): CritiqueWant[] =>
  wants.filter((w) => !(w.from && w.from.scope === from.scope && w.from.targetId === from.targetId && w.from.noteId === from.noteId))

// ---------- What is carried from one critique to the next ----------

/** Two notes about the same thing: the same kind, and the same words (or, with no words, the same title). */
export function sameNote(a: Pick<CritiqueNote, 'category' | 'title' | 'quote'>, b: Pick<CritiqueNote, 'category' | 'title' | 'quote'>): boolean {
  if (a.category !== b.category) return false
  if (a.quote.trim() && b.quote.trim()) return quotesOverlap(a.quote, b.quote)
  return !!plainQuote(a.title) && plainQuote(a.title) === plainQuote(b.title)
}

/**
 * The notes a new critique of the same scene or chapter carries from the one before: those Adam acted on or said aren't
 * needed (not "not for this story": the story keeps those), then what that one carried, newest first, each once.
 */
export function carryEarlier(previous: Pick<Critique, 'notes' | 'earlier'> | null): CritiqueNote[] {
  if (!previous) return []
  const out: CritiqueNote[] = []
  for (const n of [...previous.notes.filter((x) => x.status === 'done' || x.status === 'dismissed'), ...(previous.earlier ?? [])]) {
    if (n.status !== 'done' && n.status !== 'dismissed') continue
    if (out.some((x) => sameNote(x, n))) continue
    out.push(n)
  }
  return out.slice(0, MOST_EARLIER)
}

// ---------- What the critic is told ----------

const CATEGORY_NAMES: Record<CritiqueNote['category'], string> = {
  pacing: 'Pacing',
  tension: 'Tension',
  voice: 'Voice',
  dialogue: 'Dialogue',
  clarity: 'Clarity',
  'show-tell': 'Show and tell',
  prose: 'Prose',
  opening: 'Opening',
  ending: 'Ending',
  shape: 'Shape',
  flow: 'Flow',
  pull: 'Pull',
  other: 'Other'
}

const onWords = (n: Pick<CritiqueNote, 'quote'>, most = 140): string => (n.quote.trim() ? ` on “${cap(clean(n.quote), most)}”` : '')

/**
 * "What the author has said he wants", in its forms (longest first; '' when he has said nothing): the kinds of note not
 * for this story, the notes not needed for this scene or chapter, and those he acted on, which are settled.
 */
export function saidForms(scope: CritiqueScope, wants: CritiqueWant[], earlier: CritiqueNote[]): string[] {
  const form = (most: number, full: boolean): string => {
    const parts: string[] = []
    const told = wants.slice(0, Math.min(most, MOST_WANTS_TOLD))
    if (told.length) {
      parts.push(
        `He said these kinds of note aren't for this story: never raise them, or anything like them, in any scene of it.\n${told
          .map((w) => `- ${CATEGORY_NAMES[w.category]}: “${w.title}”${full && w.suggestion ? ` (${cap(w.suggestion, 160)})` : ''}`)
          .join('\n')}`
      )
    }
    const dismissed = earlier.filter((n) => n.status === 'dismissed').slice(0, Math.min(most, MOST_SAID))
    if (dismissed.length) {
      parts.push(
        `He said these notes aren't needed for this ${scope}: don't raise them again.\n${dismissed
          .map((n) => `- ${CATEGORY_NAMES[n.category]}: “${cap(clean(n.title), 120)}”${full ? onWords(n) : ''}`)
          .join('\n')}`
      )
    }
    const done = earlier.filter((n) => n.status === 'done').slice(0, Math.min(most, MOST_SAID))
    if (done.length) {
      parts.push(
        `He acted on these notes (he rewrote the words), so they are settled: never give the opposite note on the words he put in.\n${done
          .map(
            (n) =>
              `- ${CATEGORY_NAMES[n.category]}: “${cap(clean(n.title), 120)}”${full && n.newWords?.trim() ? `; the words are now “${cap(clean(n.newWords), 200)}”` : ''}`
          )
          .join('\n')}`
      )
    }
    return parts.join('\n\n')
  }
  const full = form(MOST_WANTS_TOLD, true)
  if (!full) return ['']
  return [full, form(4, false)]
}

/** What became of a note from last time, in the words the critic is told. */
function fate(n: CritiqueNote, gone: boolean): string {
  switch (n.status) {
    case 'done':
      return `The author acted on it: he accepted a rewrite.${n.newWords?.trim() ? ` The words are now “${cap(clean(n.newWords), 240)}”.` : ''} Settled: never give its opposite.`
    case 'dismissed':
      return 'He said it isn’t needed. Don’t raise it again.'
    case 'unwanted':
      return 'He said this kind of note isn’t for this story. Don’t raise it again.'
    default:
      return gone ? 'Still to do, but its words have changed since.' : 'Still to do: its words are as they were.'
  }
}

/** The P id of the note at `i` in the notes last time ("P1"…). */
export const earlierId = (i: number): string => `P${i + 1}`

/** "Your notes last time" (for a re-read): each note with its P id and what became of it, longest form first. */
export function earlierForms(notes: CritiqueNote[], gone: ReadonlySet<string>): string[] {
  if (!notes.length) return ['']
  const form = (full: boolean): string =>
    notes
      .map(
        (n, i) =>
          `- [${earlierId(i)}] ${CATEGORY_NAMES[n.category]}: “${cap(clean(n.title), 120)}”${onWords(n, full ? 160 : 80)}${
            full && n.suggestion.trim() ? `. You said: ${cap(clean(n.suggestion), 220)}` : ''
          } — ${fate(n, gone.has(n.id))}`
      )
      .join('\n')
  return [form(true), form(false)]
}

/** Reads a P id the critic gave back ("P2", "p2", 2) as the index of a note last time; null when it names none. */
export function earlierIndex(v: unknown, count: number): number | null {
  const m = typeof v === 'number' ? [String(v), String(v)] : typeof v === 'string' ? v.trim().match(/^\[?p?\s*(\d+)\]?$/i) : null
  if (!m) return null
  const i = Number(m[1]) - 1
  return Number.isInteger(i) && i >= 0 && i < count ? i : null
}

// ---------- Keeping a new critique to what Adam said ----------

/** A note as parse.ts reads it on a re-read: which note last time it says it gives again, if any. */
export type ReadNote = CritiqueNote & { earlierRef?: number }

export interface GuardInput {
  /** The notes last time (P1… in order), with what became of each; [] on a first reading. */
  previous: CritiqueNote[]
  /** The notes carried from earlier critiques (acted on, not needed). */
  earlier: CritiqueNote[]
  wants: CritiqueWant[]
}

/**
 * The new notes, less those that go against what Adam said: one given again that he set aside, one like a note he said
 * isn't needed here, one of a kind he said isn't for this story (the same title), and the opposite of one he acted on
 * (the same kind, on the words his accepted rewrite put in), unless the critic says it is that note given again (it
 * still stands). Kept in order, numbered n1… again; `repeated` on those the critic gave again from last time.
 */
export function guardNotes(notes: ReadNote[], o: GuardInput): CritiqueNote[] {
  const setAside = [...o.previous, ...o.earlier].filter((n) => n.status === 'dismissed' || n.status === 'unwanted')
  const done = [...o.previous.map((n, i) => ({ n, i })), ...o.earlier.map((n) => ({ n, i: -1 }))].filter(({ n }) => n.status === 'done' && !!n.newWords?.trim())
  const kept: CritiqueNote[] = []
  for (const note of notes) {
    const { earlierRef, ...n } = note
    const again = earlierRef != null ? o.previous[earlierRef] : undefined
    if (again && (again.status === 'dismissed' || again.status === 'unwanted')) continue
    if (setAside.some((x) => sameNote(x, n))) continue
    if (o.wants.some((w) => w.category === n.category && !!plainQuote(w.title) && plainQuote(w.title) === plainQuote(n.title))) continue
    if (n.quote.trim() && done.some(({ n: d, i }) => d.category === n.category && i !== earlierRef && quotesOverlap(n.quote, d.newWords ?? ''))) continue
    kept.push({ ...n, ...(again ? { repeated: true } : {}) })
  }
  return kept.map((n, i) => ({ ...n, id: `n${i + 1}` }))
}

/**
 * How many of the notes last time are settled now: those Adam acted on or set aside, and those the critic says are
 * settled, unless it gave them again (one he set aside stays settled: guardNotes leaves it out).
 */
export function settledCount(previous: CritiqueNote[], settled: number[], given: ReadNote[]): number {
  const again = new Set(
    given.map((n) => n.earlierRef).filter((i): i is number => i != null && previous[i]?.status !== 'dismissed' && previous[i]?.status !== 'unwanted')
  )
  return previous.filter((n, i) => !again.has(i) && (!!n.status || settled.includes(i))).length
}
