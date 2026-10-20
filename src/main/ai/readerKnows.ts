// The reader ledger (overhaul, 2026-10-19): what the reader has been shown that someone in the scene doesn't know. A
// scene told from Tobin's point of view in Ch 3 shows the reader the plot he overhears; in Ch 5, with Mara, the writer has
// the whole story so far in front of it and lets her sense it, or explains it to the reader again. The "Who knows what"
// block (whoKnows.ts) says only what one person here knows and another here doesn't; this says what the reader knows,
// since where, and who here doesn't:
//   "The reader knows Tobin stole the ledger (Ch 3, Sc 2); Mara doesn't: don't explain it again, or let her learn or
//    guess it without cause."
// Built from what the memory already keeps, with no new store and no AI call: the who-knows-what ledger (memory/ledger.ts,
// FactState.since: each knower's first learning of it, the scene it was in), so the reader was shown it in the first
// scene on the line where someone learned it on the page (a learning in a scene; the starting setup shows the reader
// nothing). The same safety rules as the block's secrets: only facts whose knowers rest on who was there or on Adam
// (B5, `backed`), plans that happened left out (knows.ts cleanKnows), never "doesn't know" of the person the fact is
// about, and never of someone who was the point of view of a scene where it was learned (the reader learned it through
// them, so they most likely know it, whatever the memory read). Facts someone here knows come first (the likelier slip:
// one of them lets it out, or the other guesses it), then the most lately learned. At most READER_LINES.
//
// Not in the writer's briefing yet: `readerLines` is pure, for ai/context.ts to call with the scene's memory (its facts
// and entries), the same people as the "Who knows what" block (`ledgerPeople(sceneKnowers(...))`) and the points of view
// of the scenes they were learned in, as a block of its own sent late beside block `knowledge` (who is in the scene can
// change from step to step, so it can't go in the steady part of SEND_ORDER), priority 6; Continue's briefing
// (edits/briefing.ts) could take the same lines. `readerKnows` reads all that from the open world for a scene.

import type Database from 'better-sqlite3'
import type { EntryState, FactState, ID } from '@shared/types'
import * as repo from '../db/repo'
import { sceneStart } from '../memory/scene'
import { cleanKnows, happenedOf, type KnowsContext } from './knows'
import { isPerson, namesPerson, namesUpTo, shortPlace } from './mustStay'
import { deathOf } from './deaths'

type DB = Database.Database

/** The most lines the reader ledger gives. */
export const READER_LINES = 4
/** The longest a fact's words are kept, in characters. */
const LONGEST_FACT = 200

export interface ReaderInput {
  /** Who knows what as the scene begins (SceneMemory.facts), with since when (FactState.since). */
  facts: FactState[]
  /** The people in the scene: only the living people among them count. */
  present: Pick<EntryState, 'id' | 'name' | 'kind' | 'aliases' | 'summary' | 'tags' | 'fields' | 'happened'>[]
  /** What has happened so far (knows.ts cleanKnows: plans that happened are left out). */
  happened: KnowsContext['happened']
  /** The point of view of a scene, by its id (null: none or not known). */
  povOf: (sceneId: ID) => ID | null
  /** This story's title, left off the places in it. */
  storyTitle: string
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s: string, most: number): string => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s)
/** A fact's first word in lower case when it is a common one, not a name, so it reads on from "The reader knows". */
const lowerStart = (s: string): string =>
  s.replace(/^(The|A|An|It|Its|This|That|These|Those|There|Some|Someone|Something|Nobody|No one)\b/, (w) => w.toLowerCase())

/** The object pronoun from someone's Pronouns field ("she/her" → "her"), else their name. */
function objectOf(p: Pick<EntryState, 'name' | 'fields'>): string {
  const parts = clean(p.fields?.pronouns).toLowerCase().split(/[/,\s]+/).filter(Boolean)
  const known = parts.find((w) => ['her', 'him', 'them', 'it', 'xem', 'hir', 'zir'].includes(w))
  if (known) return known
  if (parts[0] === 'she') return 'her'
  if (parts[0] === 'he') return 'him'
  if (parts[0] === 'they') return 'them'
  return p.name
}

/** The reader ledger's lines for these people (see the top of this file). Pure. */
export function readerLines(o: ReaderInput): string[] {
  const here = o.present.filter((p, i, all) => isPerson(p) && !clean(deathOf(p)?.note) && all.findIndex((x) => x.id === p.id) === i)
  if (!here.length) return []
  const found: { text: string; held: boolean; at: number; i: number }[] = []
  cleanKnows(o.facts, { happened: o.happened }).forEach((f, i) => {
    if (f.backed === false) return
    const fact = lowerStart(clip(clean(f.fact).replace(/[.]+$/, ''), LONGEST_FACT))
    if (!fact) return
    // Where someone learned it on the page, on this scene's line: the reader was shown it in the first of those scenes.
    const learned = f.knownBy.flatMap((id) => {
      const l = f.since?.[id]
      return l?.sceneId && l.at >= 0 ? [l] : []
    })
    if (!learned.length) return
    const shown = learned.reduce((a, b) => (b.at < a.at ? b : a))
    const povs = new Set(learned.map((l) => o.povOf(l.sceneId!)).filter((x): x is ID => !!x))
    const missing = here.filter((p) => !f.knownBy.includes(p.id) && !namesPerson(f.fact, p) && !povs.has(p.id))
    if (!missing.length) return
    const where = shortPlace(clean(shown.where), o.storyTitle)
    const one = missing.length === 1
    const who = namesUpTo(missing.map((p) => p.name))
    const them = one ? objectOf(missing[0]) : 'them'
    found.push({
      text: `The reader knows ${fact}${where ? ` (${where})` : ''}; ${who} ${one ? 'doesn’t' : 'don’t'}: don’t explain it again, or let ${them} learn or guess it without cause.`,
      held: here.some((p) => f.knownBy.includes(p.id)),
      at: Math.max(...learned.map((l) => l.at)),
      i
    })
  })
  return found
    .sort((a, b) => Number(b.held) - Number(a.held) || b.at - a.at || b.i - a.i)
    .slice(0, READER_LINES)
    .map((x) => x.text)
}

/**
 * What the reader has been shown that the people present (`presentIds`) don't know, as the scene `atSceneId` begins, as
 * short lines (readerLines). Empty when the scene isn't in that story, or nothing is known. Never throws.
 */
export function readerKnows(db: DB, storyId: ID, atSceneId: ID, presentIds: ID[]): string[] {
  try {
    const { story, state } = sceneStart(db, atSceneId, { forWriter: true })
    if (story.id !== storyId || !presentIds.length) return []
    const entries = [...state.entries.values()]
    const byId = new Map(entries.map((e) => [e.id, e]))
    const present = presentIds.flatMap((id) => byId.get(id) ?? [])
    const scenes = [...new Set(state.facts.flatMap((f) => Object.values(f.since ?? {}).flatMap((l) => (l.sceneId ? [l.sceneId] : []))))]
    const cards = scenes.length ? repo.sceneCards(db, scenes) : new Map()
    return readerLines({
      facts: state.facts,
      present,
      happened: happenedOf(entries),
      povOf: (id) => cards.get(id)?.povId ?? null,
      storyTitle: story.title
    })
  } catch (e) {
    console.warn('Could not work out what the reader knows', e)
    return []
  }
}
