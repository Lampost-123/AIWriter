// What the planner gets at no cost before it plans a scene (overhaul, "Plan before writing, done properly", step 1),
// from the story index (storyIndex/): everyone in the scene as things stand there, what happens in the scenes of the last
// two chapters (so it doesn't plan as still to come what has already happened), the plot threads open there, and what was
// left in the scene's place on an earlier visit (place memory, storyIndex/placed.ts: "Left here before: …"). The
// index is brought up to date first (cheap when little changed: a scene is built again only when what it is built from
// changed). Reads the database; no Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { stageFor } from '../ai/mustStay'
import { toldStage, type ContextInput } from '../ai/context'
import * as sidx from '../db/storyIndex'
import { buildStoryIndex, leftHere, leftHereLines, openThreads, stateOf, type EntryNow } from '../storyIndex'
import { clip, wholeSentences } from '../ai/lookups/text'
import { onStageIn } from '../storyIndex/there'
import { gettingHere } from '../storyIndex/routes'

type DB = Database.Database

/** What the story index says of each person here, by the stage's field, for the plan's check (plan.ts checkPlan). */
export type KnownFacts = Record<string, Partial<Record<'where' | 'wearing' | 'holding' | 'condition', string[]>>>

export interface PlanCore {
  storyId: ID
  /** Read as the scene begins (a whole scene to write), or as its words so far end (carrying on). */
  asItBegins: boolean
  /** Everyone in the scene as the index has them, a few lines each ("Mara Venn: wearing grey coat (since Ch 1, Sc 1)"). */
  people: string[]
  known: KnownFacts
  /** What happens in the scenes of the last two chapters before this one, a line each, oldest first. */
  recent: string[]
  /** The plot threads open here, longest open first. */
  threads: string[]
  /**
   * What was left in the scene's place (or a room in it, or the house its room is in) on an earlier visit and not taken
   * or moved since, a line each ("Left here before: the letter under the loose hearthstone (since Ch 2, Sc 3)"); never
   * what where things stand, as told here, already has in the place.
   */
  left: string[]
  /**
   * How long it takes to get here from where the people here last were, when the story knows the route (storyIndex/routes.ts
   * gettingHere: "Getting here: Linmouth to Carrow is about 3 days by cart"). Empty: no route known.
   */
  travel: string[]
  /** Everyone in the scene (the card, and whoever the stage and the words put there), for what the plan's beats need. */
  present: ID[]
  /**
   * What the scene card says that the story so far doesn't allow ("Before writing, note: …"; plan/cardCheck.ts), for the
   * planner to resolve. Left out: none (set by plan/index.ts once the card is checked).
   */
  notes?: string[]
}

/** The most lines: of each person's state, of everyone's, of the scenes before, of the threads, of the things left here. */
export const CORE_MOST = { each: 7, people: 28, recent: 16, threads: 8, left: 6 }
/** How many chapters back the scenes before are told from (this one and the one before). */
const RECENT_CHAPTERS = 2

const chapterOf = (label: string): number | null => {
  const m = /^Ch (\d+), Sc \d+$/.exec(label)
  return m ? Number(m[1]) : null
}

/**
 * The core for a scene, or null when its story can't be read in the index. `carryingOn`: the draft carries on from the
 * scene's words so far (Add below, a later beat), so the index is read as they end. Never names what Adam kept out.
 */
export function planCore(db: DB, input: ContextInput, sceneId: ID, o: { carryingOn: boolean; hidden: ReadonlySet<ID> }): PlanCore | null {
  const storyId = input.memory.storyId
  if (!storyId) return null
  buildStoryIndex(db, storyId)
  const point = sidx.indexScene(db, sceneId)
  if (!point || point.storyId !== storyId) return null
  const asItBegins = !o.carryingOn

  // Everyone in the scene: the card's point of view and people, and anyone on the stage as told here whom the words put
  // there (2026-10-19: never someone only thought of or talked of, whatever the stage lists; nor someone named only by
  // another's name, what is theirs, or what they once said or may do: storyIndex/there.ts).
  const card = input.scene.card
  const stage = toldStage(input)
  const ids = [card.povId, ...card.presentIds].filter((id): id is ID => !!id)
  const words = [card.goal, card.conflict, card.outcome, card.notes, ...card.beats, input.options.direction, input.soFar].filter((t) => t?.trim()).join('\n')
  for (const e of input.memory.entries) {
    const on = e.kind === 'character' && !ids.includes(e.id) ? stageFor(e, stage) : null
    if (on && onStageIn(words, { ...e, aliases: [on.name, ...(e.aliases ?? [])].filter((n) => n !== e.name) })) ids.push(e.id)
  }
  const people = [...new Set(ids)].filter((id) => !o.hidden.has(id))
  const hiddenNames = input.memory.entries.filter((e) => o.hidden.has(e.id)).map((e) => e.name.toLowerCase())
  const free = (l: string): boolean => !hiddenNames.some((n) => n.length >= 2 && l.toLowerCase().includes(n))

  const lines: string[] = []
  const known: KnownFacts = {}
  for (const id of people) {
    const now = stateOf(db, storyId, id, sceneId, { asItBegins })
    if (!now) continue
    known[now.name.toLowerCase()] = factsOf(now)
    const own = now.lines.filter(free)
    const knows = own.filter((l) => l.startsWith(`${now.name} knows:`))
    const ties = own.filter((l) => l.startsWith(`${now.name} and `))
    const rest = own.filter((l) => !knows.includes(l) && !ties.includes(l))
    lines.push(...[...rest, ...ties.slice(0, 2), ...knows.slice(0, 2)].slice(0, CORE_MOST.each).map((l) => clip(l, 240)))
  }

  // The scenes of this chapter and the one before, before this one, with what happens in each.
  const at = chapterOf(point.label)
  const recent = sidx
    .indexScenesBetween(db, storyId, 1, Math.max(0, point.position - 1))
    .filter((s) => s.gist && (at == null || (chapterOf(s.label) ?? 0) > at - RECENT_CHAPTERS))
    .map((s) => `${s.label}: ${wholeSentences(s.gist, 300)}`)
    .filter(free)
    .slice(-CORE_MOST.recent)

  const threads = openThreads(db, storyId, sceneId, { asItBegins })
    .lines.filter(free)
    .slice(0, CORE_MOST.threads)
    .map((l) => clip(l, 240))
  const left = leftHereLines(
    leftHere(db, storyId, sceneId, card.locationId, { asItBegins }).things,
    stage
  )
    .filter(free)
    .slice(0, CORE_MOST.left)
    .map((l) => clip(l, 240))
  let travel: string[] = []
  try {
    travel = gettingHere(db, storyId, sceneId).filter(free).slice(0, 3).map((l) => clip(l, 240))
  } catch (e) {
    console.warn('Could not work out how long it takes to get here', e)
  }
  return { storyId, asItBegins, people: lines.slice(0, CORE_MOST.people), known, recent, threads, left, travel, present: people }
}

/** What the index says of one person, by the stage's field: where (never only "last seen"), what they wear, carry and suffer. */
function factsOf(now: EntryNow): KnownFacts[string] {
  const out: KnownFacts[string] = {}
  if (now.place && !now.place.lastSeen) out.where = [now.place.value]
  if (now.wearing.length) out.wearing = now.wearing.map((w) => w.value)
  if (now.carrying) out.holding = [now.carrying.value]
  if (now.condition) out.condition = [now.condition.value]
  return out
}
