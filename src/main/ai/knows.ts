// Cleaning up who knows what before the writer reads it (Adam, 2026-10-08). An audit of 122 real writer calls found the
// relationships block with 37 "Ash does not know…" lines, many false ("Wren does not know: Wren will go up to the
// abbey"), and "What Wren knows" with 70 lines, duplicates and plans long past among them. So:
// - the same fact said twice (or once inside a longer one) is given once, the newest;
// - a plan or intention ("will", "is going to", "promised to") is left out once it has happened (a later note says the
//   same thing), or once its time has passed (it was for tonight, tomorrow or the morning, and two or more later scenes
//   have gone by);
// - a death's note loses its "this afternoon" once it is told days later.
// What some of those present know and others don't is mustStay.ts's realSecrets, built on these. Pure.

import type { EntryState, FactState } from '@shared/types'

const STOP = new Set(
  (
    'a an the and or but if so as at by for from in into of off on onto out over to up with about after before he she it ' +
    'they them him her his hers its their i me my we us our you your this that these those there here was were is are be ' +
    'been had has have do did does not no then than too very just only all any some what which who when where will would ' +
    'shall going one'
  ).split(' ')
)

const norm = (s: string): string => s.replace(/[’‘]/g, "'").toLowerCase()
/** A text's own words (not little ones, but any number), by their first four letters ("give" and "given" alike). */
export const stemsOf = (s: string): string[] => [
  ...new Set(
    (norm(s).match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? []).filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)).map((w) => w.slice(0, 4))
  )
]

/** A plan or intention, not yet a fact of what happened: "Wren will cross at the ferry", "Gale is going to ask again". */
export const isPlan = (fact: string): boolean =>
  /\b(will|shall|won't|is going to|are going to|was going to|intends? to|means to|plans? to|promised to|swore to|vowed to)\b|['’]ll\b/i.test(fact)

/** A plan for a time close at hand: tonight, tomorrow, the morning, soon. */
const SOON = /\b(tonight|tomorrow|today|this (morning|afternoon|evening|night)|in the morning|at (dawn|first light|daybreak|sunrise|noon|dusk)|by (morning|nightfall|dark|noon)|soon|before (dark|nightfall|morning))\b/i

/** How much of a fact's words another must hold for the two to be the same fact (or the plan to have happened). */
const SAME = 0.8
const HAPPENED = 0.7

/** True when most of `a`'s own words are in `b`. */
const within = (a: string[], b: Set<string>, share: number): boolean => a.length > 0 && a.filter((w) => b.has(w)).length >= Math.ceil(a.length * share)

export interface KnowsContext {
  /** What has happened to the entries so far, with where on the line (each EntryState's `happened`). */
  happened: { note: string; at?: number }[]
}

/** The happened notes of these entries, for cleanKnows, each with the entry's name (a note has no subject: "given to Pell"). */
export const happenedOf = (entries: Pick<EntryState, 'name' | 'happened'>[]): KnowsContext['happened'] =>
  entries.flatMap((e) => (e.happened ?? []).map((h) => ({ note: `${e.name} ${h.note}`, at: h.at })))

/**
 * The facts worth telling, in their order: one of each (the newest of two that say the same thing), and no plan that
 * has happened or whose time has passed. Facts without a place on the line (`at`) are never judged past.
 */
export function cleanKnows<T extends Pick<FactState, 'fact' | 'at'>>(facts: T[], ctx: KnowsContext): T[] {
  const later = (at: number | undefined): { note: string; at?: number }[] => (at == null ? [] : ctx.happened.filter((h) => (h.at ?? -Infinity) > at))
  const scenesAfter = (at: number | undefined): number => new Set(later(at).map((h) => h.at)).size
  const kept = facts.filter((f) => {
    const text = (f.fact ?? '').trim()
    if (!text) return false
    if (!isPlan(text)) return true
    if (SOON.test(text) && scenesAfter(f.at) >= 2) return false
    const own = stemsOf(text)
    if (own.length >= 3 && later(f.at).some((h) => within(own, new Set(stemsOf(h.note)), HAPPENED))) return false
    return true
  })
  // The same fact twice: the newest is kept (the later one listed, among the same place or none).
  const stems = kept.map((f) => stemsOf(f.fact))
  const sets = stems.map((s) => new Set(s))
  const rank = (i: number): number => kept[i].at ?? -2
  return kept.filter((_, i) =>
    !kept.some((__, j) => {
      if (j === i || !within(stems[i], sets[j], SAME)) return false
      // i says nothing j doesn't: i goes, unless j says no more than i and i is newer (then j goes instead).
      const same = within(stems[j], sets[i], SAME)
      if (!same) return true
      return rank(j) > rank(i) || (rank(j) === rank(i) && j > i)
    })
  )
}

/** Words that tie a note to the day it was written ("died this afternoon"), wrong once it is told days later. */
const RELATIVE_TIME =
  /\s*\b(?:(?:earlier|later|late|early)\s+)?(?:this|that)\s+(?:morning|afternoon|evening|night)\b|\s*\b(?:earlier\s+)?today\b|\s*\btonight\b|\s*\byesterday\b|\s*\bjust now\b|\s*\ba (?:moment|minute|few minutes) ago\b/gi

/** A death's note as told later: in the past, without "this afternoon", "today" or "just now". */
export function pastDeathNote(note: string): string {
  return note
    .replace(RELATIVE_TIME, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
