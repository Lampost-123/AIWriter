// What a consistency check of one scene is given (milestone 5, AI checks): the memory as it stands at the
// START of the scene, on the scene's own story's line, so a contradiction with earlier scenes or with Adam's
// notes is caught even though the memory keeper has already followed this scene's text. It is the same
// memory a draft of the scene is briefed with (memory/scene.ts sceneMemory: the line up to just before the
// scene), read the same way.
//
// Each check needs its own part of it:
//   facts      every entry the scene card lists or the text names, with its state (looks, injuries, what
//              has happened to it: "died in the fire"), and the world's absolute rules
//   knowledge  who knows what at this point, and who among those present doesn't: the who-knows-what ledger as the
//              scene begins (long story memory fix 9), each knower with since when and how, and what anyone here
//              believes that isn't true
//   timeline   the scenes just before on the line: when and where each was, and who was there; the end of
//              the scene before; this scene's own When and place
//   voice      each speaking character's voice notes and sample lines (in their profile)
//   style      the style guide's point of view and tense, the genre and content levels, and the scene card's mood
// Since 2026-10-16 ("The checker catches more"): entries tied to the scene though its words don't name them
// (relatedEntries), the facts of who knows what ranked by the scene's own words before recency (factRelevance; the facts
// check gets the ten it touches most), the card's plan as the author's intent, the story calendar's date and time since
// the scene before, and the plot threads still open with when each is due.
// Entries and earlier scenes get short ids (E1, S1) that the reply refers to. No Electron imports.

import type Database from 'better-sqlite3'
import type { CheckKind } from '@shared/contracts/checks'
import type { BeliefState, ContextBlock, EntryState, FactState, ID, SceneCard, ThreadDue, WritingPrefs } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { effectiveStyle } from '@shared/style'
import { genreLabel, genresOf } from '@shared/genres'
import { intensityLines } from '@shared/intensity'
import type { SceneMemory } from '../memory/types'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import { loadShape, sceneMemory } from '../memory/scene'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { deadBy, formatProfile, happenedText, mentions, sceneTail, SHORT_TAIL, storySoFarText } from '../ai/context'
import { stateText, type SceneState } from '@shared/continuity'
import { keptStateBefore } from '../continuity/tracker'
import { estimateTokens } from '../keeper/text'
import { contentNoteFor } from '../keeper/model'
import { holdingLine, holdingsFirst, holdingsOf, itemHeads, nameIn, namesOf, type Holding } from '../memory/items'
import { isPerson, namesPerson } from '../ai/mustStay'
import { lessonLine, lessonsBefore, type Lesson } from './lessons'
import { learnedWords } from '@shared/knowWords'
import { KeywordIndex } from '../retrieval/rank'
import { withoutNames } from '../retrieval/recall'
import { sceneCalendar, type SceneCalendar } from '../memory/storyCalendar'
import { storyDateLines } from '../ai/storyDate'
import { openThreadsAt, type OpenThread } from '../ai/openThreads'

type DB = Database.Database

/** How many scenes before this one the timeline check is told about. */
export const EARLIER_SCENES = 3
/** The most facts listed under "Who knows what". */
const MOST_FACTS = 40
/**
 * The most facts the facts check is told about who knows what: those the scene's own words touch (2026-10-16: the facts
 * check had none, so "who heard what" and how someone died long ago could only be checked against the story so far).
 */
export const FACTS_FOR_FACTS = 10
/** A fact or an entry counts as touched by the scene's words when it scores at least this share of the best (factRelevance). */
const TOUCH_KEEP = 0.3
/**
 * How much a fact's closeness to the scene's own words counts in factsThatMatter (0 to 1, times this), against 2 for naming
 * something the scene names and 1 for someone here: on the long test book's live world, at 2, facts naming the clock-house
 * or the great clock crowded out "Leckie's heart is failing" from a scene about it.
 */
const RANK_WEIGHT = 4
/** The most entries brought in because they are tied to the scene though its words don't name them (relatedEntries). */
export const MOST_RELATED = 8
/**
 * How much an entry must score to be tied to the scene (relatedEntries): one tie of its own (held, or naming someone here
 * besides the point of view), a step from an entry here, or words close to the scene's own.
 */
const RELATED_KEEP = 0.75
/** The most open plot threads a check is told about. */
export const MOST_THREADS = 6
/** The most beats of the card's plan a check is told. */
const MOST_BEATS = 10
/** The most entries told in full; any more are told in a line each. */
const MOST_FULL = 24
/** The most lines about what people here gave away, lost or got. */
export const MOST_OWNED = 12
/** The most lines saying what someone here believes that isn't true (long story memory fix 9). */
export const MOST_BELIEFS = 12
/** The most findings from earlier scenes the author said are meant (for each of CHECK_GROUPS' requests). */
export const MOST_MEANT = 8
/**
 * The checks asked together in one request: what is so, then who knows what and how it reads. A live run found one
 * request for all six spread the model thin and missed plain contradictions, so they stay two requests, which share
 * their opening (2026-10-19: the same instructions, material and scene, each request's own checks last).
 */
export const CHECK_GROUPS: CheckKind[][] = [
  ['facts', 'timeline', 'continuity'],
  ['knowledge', 'voice', 'style']
]
/**
 * The checks asked in both requests when a scene's checks take two (checkfix, 2026-10-20). The released app's two requests
 * each answered all six checks (its instructions said "one item for each check above" right under the line naming all
 * six), so every slip was looked at twice; since the requests share one opening (2026-10-19) each asked only its own
 * three, and a live run of the book caught 6 of 13 planted slips against 10 of 12. What is known (facts, who knows what)
 * is asked in both again: the opening is the same and cached, so it costs the extra replies only, and a slip both requests
 * find is kept without the second opinion (checks/run.ts corroborated).
 */
export const ASKED_IN_BOTH: CheckKind[] = ['facts', 'knowledge']

/**
 * The requests a scene's checks are made in, each with its checks in the order its task names them: CHECK_GROUPS' own
 * checks first, then those of ASKED_IN_BOTH it lacks, when there are two requests. One request (`together`: Write the whole
 * chapter's state check; or only one group's checks asked) asks each check once.
 */
export function checkRequests(checks: CheckKind[], together = false): CheckKind[][] {
  if (together) return checks.length ? [checks] : []
  const own = CHECK_GROUPS.map((g) => checks.filter((c) => g.includes(c))).filter((g) => g.length)
  if (own.length < 2) return own
  const both = ASKED_IN_BOTH.filter((c) => checks.includes(c))
  return own.map((g) => [...g, ...both.filter((c) => !g.includes(c))])
}
/** Which check each kind of finding the author said is meant belongs to (voice and style since 2026-10-16). */
const MEANT_CHECK: Partial<Record<Lesson['kind'], CheckKind>> = { fact: 'facts', knowledge: 'knowledge', timeline: 'timeline', voice: 'voice', style: 'style' }

/** One entry the check is told about. */
export interface CheckEntry {
  code: string
  entry: EntryState
  /** Why it is here: "point of view", "present", "where it happens", "named in the scene", "a rule of the world". */
  why: string
  /** For an entry that doesn't exist at this point: "not in the story yet at this point". */
  label: string | null
}

/** One of the scenes just before this one. */
export interface CheckScene {
  code: string
  sceneId: ID
  label: string
  title: string
  when: string
  place: string
  present: string[]
  summary: string
}

export interface SceneCheckContext {
  sceneId: ID
  storyId: ID
  /** "Book 1, Ch 2, Sc 3". */
  where: string
  title: string
  text: string
  card: SceneCard
  memory: SceneMemory
  entries: CheckEntry[]
  earlier: CheckScene[]
  style: {
    pov: string
    tense: string
    proseStyle: string
    tone: string
    genre?: string
    content?: string[]
    /** Content set above its second step: every check is told the story means it (keeper/model.ts contentNoteFor). */
    strong?: string | null
  }
  /** Where things stood as the previous scene ended (continuity/tracker.ts), if it still stands. */
  continuity: SceneState | null
  /** The story so far, as the writer gets it: in full (chapters and the last few scenes) and short (the most recent parts). */
  storySoFar: { full: string; short: string }
  /**
   * What Adam said is meant when the checks raised it in earlier scenes, about entries the check is told of, newest first
   * (checks/lessons.ts): not raised again here. Left out: none.
   */
  meant?: Lesson[]
  /**
   * How much each fact of who knows what matters to the scene's own words (factRelevance, 0 to 1; 2026-10-16), by
   * keyword and, when the search model is on, by meaning (checks/run.ts). Left out: by names and recency alone.
   */
  factRank?: Map<ID, number>
  /** The story calendar at the scene (long story memory fix 11): its date and how long since the scene before. Null: unknown. */
  calendar?: SceneCalendar | null
}

const clean = (s: string | null | undefined): string => (s ?? '').trim()
const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

/** Gathers what a check of this scene is told. Throws (plain words) when the scene has gone. */
export function gatherSceneCheck(db: DB, sceneId: ID, prefs: WritingPrefs): SceneCheckContext {
  const scene = repo.getScene(db, sceneId)
  const { story } = repo.sceneLocation(db, sceneId)
  const memory = sceneMemory(db, sceneId, { forWriter: true, dropGuesses: true })
  const shape = loadShape(db)
  const label = labeler(shape)
  const card = scene.card
  const text = scene.text ?? ''

  const here = new Map(memory.entries.map((e) => [e.id, e]))
  const away = new Map(memory.elsewhere.map((x) => [x.entry.id, x]))
  const firstHere = new Set(memory.firstHere)
  // An item is found by its own main word too ("the compass" for "The brass compass": memory/items.ts).
  const heads = headsAt(memory)
  const entries: CheckEntry[] = []
  const taken = new Set<ID>()
  const take = (id: ID | null | undefined, why: string): void => {
    if (!id || taken.has(id)) return
    const e = here.get(id) ?? away.get(id)?.entry
    if (!e) return
    taken.add(id)
    const lbl = away.get(id)?.label ?? (firstHere.has(id) ? 'first appears in this scene' : null)
    entries.push({ code: `E${entries.length + 1}`, entry: e, why, label: lbl })
  }
  take(card.povId, 'point of view')
  for (const id of card.presentIds ?? []) take(id, 'present')
  take(card.locationId, 'where it happens')
  // Everything the text names, in the order it first does (those that don't exist here too: a dead or
  // not-yet-met character named in the scene is just what the checks are for).
  const named = [...here.values(), ...[...away.values()].map((x) => x.entry)]
    .map((e) => ({ e, at: firstMention(text, namesOf(e, heads)) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
  for (const { e } of named) take(e.id, 'named in the scene')
  for (const e of memory.entries) if (e.kind === 'lore' && e.hardRule) take(e.id, 'a rule of the world')
  // Tied to the scene though its words don't name them (2026-10-16: the long test book's sledge, called only by its name
  // there, and the town a named person lives in): the point of view's family the words speak of ("her father"), what
  // people here hold, and entries that name someone here, that an entry here names, or that share the scene's own words.
  const people = entries.filter((c) => c.entry.kind === 'character' && !c.label).map((c) => c.entry.id)
  const namedHere = new Set(entries.filter((c) => c.why === 'named in the scene').map((c) => c.entry.id))
  for (const r of relatedEntries(memory, { taken, named: namedHere, people, povId: card.povId, text, heads })) take(r.id, r.why)

  // The scenes just before this one on the line (in any story the line goes through).
  const line = storyOfScene(shape, sceneId) ? buildLine(shape, { storyId: story.id, before: sceneId }) : null
  const steps = (line?.steps ?? []).filter((s): s is Extract<typeof s, { type: 'scene' }> => s.type === 'scene' && s.via === 'line')
  const nameOf = (id: ID | null | undefined): string => (id ? (here.get(id)?.name ?? away.get(id)?.entry.name ?? '') : '')
  const earlier: CheckScene[] = []
  for (const step of steps.slice(-EARLIER_SCENES)) {
    try {
      const s = repo.getScene(db, step.sceneId)
      earlier.push({
        code: `S${earlier.length + 1}`,
        sceneId: s.id,
        label: label({ storyId: step.storyId, sceneId: s.id }),
        title: s.title,
        when: clean(s.card.when),
        place: nameOf(s.card.locationId),
        present: [s.card.povId, ...(s.card.presentIds ?? [])].filter((x, i, all) => x && all.indexOf(x) === i).map(nameOf).filter(Boolean),
        summary: clean(kdb.summaryRow(db, 'scene', s.id)?.text)
      })
    } catch {
      /* deleted meanwhile: left out */
    }
  }

  const style = effectiveStyle(prefs, repo.getWorldStyle(db), story.style)
  const sofar = memory.storySoFar
  return {
    sceneId,
    storyId: story.id,
    where: label({ storyId: story.id, sceneId }),
    title: scene.title,
    text,
    card,
    memory,
    entries,
    earlier,
    style: {
      pov: clean(style.pov),
      tense: clean(style.tense),
      proseStyle: clean(style.proseStyle),
      tone: clean(story.tone),
      genre: genreText(style.genres),
      content: intensityLines(style.intensity),
      strong: contentNoteFor(style.intensity)
    },
    continuity: keptStateBefore(db, sceneId),
    storySoFar: sofar ? { full: storySoFarText(sofar, story.title, 1), short: storySoFarText(sofar, story.title, 3) } : { full: '', short: '' },
    // About the entries here; a style finding about no one (a recent one, checks/lessons.ts) holds for any scene.
    meant: lessonsBefore(db, sceneId).meant.filter((l) => !l.entryIds.length || l.entryIds.some((id) => taken.has(id))),
    factRank: factRelevance(factPool(memory.facts, characterStates(entries)), text, personNames(entries)),
    calendar: calendarAt(db, sceneId, memory, card)
  }
}

/** The story calendar at a scene for its check; null rather than stopping the check. */
function calendarAt(db: DB, sceneId: ID, memory: SceneMemory, card: SceneCard): SceneCalendar | null {
  try {
    return sceneCalendar(db, sceneId, memory, card)
  } catch (e) {
    console.warn('Could not work out the story calendar for a check; it goes by the scene cards’ When', e)
    return null
  }
}

/** The characters a check is told about who exist here (those the knowledge check asks about). */
const characterStates = (entries: CheckEntry[]): EntryState[] => entries.filter((c) => c.entry.kind === 'character' && !c.label).map((c) => c.entry)

/** The facts a check of this scene may be told of (factPool over the characters here): what checks/run.ts ranks by meaning. */
export const factsToRank = (ctx: Pick<SceneCheckContext, 'memory' | 'entries'>): FactState[] => factPool(ctx.memory.facts, characterStates(ctx.entries))

/** The names of the characters here, left out of what the scene's words are matched by (every fact about them has them). */
export const personNames = (entries: CheckEntry[]): string[] => characterStates(entries).flatMap((e) => [e.name, ...(e.aliases ?? [])])

/** The facts a check may be told of: those someone here knows, or that name one of them. */
export function factPool(facts: FactState[], people: EntryState[]): FactState[] {
  const ids = new Set(people.map((e) => e.id))
  return facts.filter((f) => f.knownBy.some((id) => ids.has(id)) || people.some((p) => mentions(f.fact, p.name)))
}

/**
 * How much each fact matters to the scene's own words, 0 to 1 (2026-10-16: the long test book's checks were told the 40
 * most lately learned facts, so "her father drowned" and who heard the healer were cut): keyword search of the facts for
 * the scene's words, without the names of the people here (BM25, retrieval/rank.ts), each as a share of the best; and,
 * when the search model is on, `meaning` (checks/run.ts: each fact's closeness in meaning to the scene, 0 to 1). A fact
 * scoring under TOUCH_KEEP of the best in both is left out.
 */
export function factRelevance(facts: FactState[], text: string, skipNames: string[] = [], meaning?: ReadonlyMap<ID, number> | null): Map<ID, number> {
  const out = new Map<ID, number>()
  if (!facts.length || !text.trim()) return out
  const found = new KeywordIndex(facts, (f) => f.fact).search(withoutNames(text, skipNames), facts.length, 0)
  const best = found[0]?.score ?? 0
  for (const r of found) {
    const s = best > 0 ? r.score / best : 0
    if (s >= TOUCH_KEEP) out.set(r.item.factId, s)
  }
  for (const [id, s] of meaning ?? []) if (s >= TOUCH_KEEP && s > (out.get(id) ?? 0)) out.set(id, Math.min(1, s))
  return out
}

// ---------- Entries tied to the scene though it doesn't name them ----------

/** Family words the point of view's narration may use for someone ("her father"), and the words a relationship may use. */
const KIN: Record<string, string[]> = {
  father: ['father', 'parent', 'dad', 'papa'],
  mother: ['mother', 'parent', 'mum', 'mam', 'mama'],
  brother: ['brother', 'sibling'],
  sister: ['sister', 'sibling'],
  son: ['son', 'child'],
  daughter: ['daughter', 'child'],
  husband: ['husband', 'spouse', 'married'],
  wife: ['wife', 'spouse', 'married'],
  grandfather: ['grandfather', 'grandparent'],
  grandmother: ['grandmother', 'grandparent'],
  uncle: ['uncle'],
  aunt: ['aunt'],
  cousin: ['cousin'],
  nephew: ['nephew'],
  niece: ['niece']
}
const KIN_SAID = new RegExp(`\\b(?:her|his|their|my|your|our)\\s+(?:late\\s+|dead\\s+|old\\s+|own\\s+|dear\\s+)?(${Object.keys(KIN).join('|')})s?\\b`, 'gi')
const kinRe = (words: string[]): RegExp => new RegExp(`\\b(?:${words.join('|')})s?\\b`, 'i')

/** Why an entry tied to the scene is there (relatedEntries), as its CheckEntry says. */
export const RELATED_WHYS: readonly string[] = ['family of the point of view', 'held by someone here', 'tied to someone here', 'tied to something here', 'close to the scene’s words']

/** Which kinds of entry come first among those tied to the scene: what someone carries or uses, then where. */
const KIND_ORDER: Partial<Record<EntryState['kind'], number>> = { item: 0, place: 1, character: 2 }

/** An entry's own words: its names, summary, description and fields (never its sample lines). */
const ownText = (e: EntryState): string =>
  [e.name, ...(e.aliases ?? []), e.summary, e.description, ...Object.entries(e.fields ?? {}).filter(([k]) => k !== 'sampleLines').map(([, v]) => v)]
    .map((x) => clean(x))
    .filter(Boolean)
    .join('. ')

/**
 * Entries tied to a scene though its words don't name them (2026-10-16), at most `most`, best first:
 *   - the point of view's family the words speak of ("her father"): by a relationship that says so, or a summary that
 *     names the point of view with the family word ("Tamsin's brother");
 *   - then, scored: what people here hold now (memory/items.ts), entries an entry already told names (one step: the town a
 *     named person lives in; most when the scene names that entry), how much an entry's own words share the scene's
 *     distinctive words (keyword search, without the names of the people here), and entries whose own words name someone
 *     here (half as much for naming only the point of view, unless it is an item; an event half again). What scores
 *     under RELATED_KEEP is left out.
 * Never a plot thread (the threads have their own section) nor anything already `taken`.
 */
export function relatedEntries(
  memory: Pick<SceneMemory, 'entries' | 'relationships'>,
  o: {
    taken: ReadonlySet<ID>
    /** Those the scene's words name (among `taken`); left out: all of `taken`. */
    named?: ReadonlySet<ID>
    people: ID[]
    povId: ID | null
    text: string
    heads?: Map<ID, string[]>
    most?: number
  }
): { id: ID; why: string }[] {
  const most = o.most ?? MOST_RELATED
  if (most <= 0 || !o.text.trim()) return []
  const heads = o.heads ?? itemHeads(memory.entries)
  const byId = new Map(memory.entries.map((e) => [e.id, e]))
  const out: { id: ID; why: string }[] = []
  const seen = new Set(o.taken)
  const add = (id: ID, why: string): void => {
    if (out.length >= most || seen.has(id) || byId.get(id)?.kind === 'thread' || !byId.has(id)) return
    seen.add(id)
    out.push({ id, why })
  }

  // The point of view's family the words speak of.
  const pov = o.povId ? byId.get(o.povId) : undefined
  const said = [...new Set([...o.text.matchAll(KIN_SAID)].map((m) => m[1].toLowerCase()))]
  if (pov && said.length) {
    const kin = kinRe(said.flatMap((k) => KIN[k] ?? [k]))
    for (const r of memory.relationships) {
      const other = r.aId === pov.id ? r.bId : r.bId === pov.id ? r.aId : null
      if (other && byId.get(other)?.kind === 'character' && kin.test(r.type ?? '')) add(other, 'family of the point of view')
    }
    const povNames = namesOf(pov, heads)
    const exact = kinRe(said)
    for (const e of memory.entries) {
      if (e.kind !== 'character' || e.id === pov.id) continue
      const own = `${e.summary ?? ''}. ${e.fields?.role ?? ''}`
      if (exact.test(own) && povNames.some((n) => nameIn(own, n))) add(e.id, 'family of the point of view')
    }
  }
  if (out.length >= most) return out

  // Scored: held here, naming someone here, named by an entry here, and the scene's own words.
  const here = o.people.map((id) => byId.get(id)).filter((e): e is EntryState => !!e)
  const hereNames = here.map((e) => ({ id: e.id, names: namesOf(e, heads) }))
  const held = new Set(
    o.people.length ? holdingsOf({ entries: memory.entries, relationships: memory.relationships, people: o.people }).filter((h) => h.has).map((h) => h.itemId) : []
  )
  // What the entries already told say of others (one step), those the scene names first: theirs are the most telling.
  const textOf = (ids: Iterable<ID>): string[] =>
    [...ids].map((id) => byId.get(id)).filter((e): e is EntryState => !!e).map((e) => ownText({ ...e, name: '', aliases: [] }))
  const namedIds = o.named ?? o.taken
  const namedText = textOf(namedIds)
  const toldText = textOf([...o.taken].filter((id) => !namedIds.has(id)))
  const pool = memory.entries.filter((e) => !seen.has(e.id) && e.kind !== 'thread')
  if (!pool.length) return out
  const words = new KeywordIndex(pool, ownText).search(withoutNames(o.text, here.flatMap((e) => [e.name, ...(e.aliases ?? [])])), pool.length, 0)
  const best = words[0]?.score ?? 0
  const overlap = new Map(words.map((r) => [r.item.id, best > 0 ? r.score / best : 0]))
  const scored = pool.flatMap((e) => {
    // Its names count too: "Bettany’s house" is tied to Bettany.
    const own = ownText(e)
    const isHeld = held.has(e.id)
    const who = hereNames.filter((h) => h.names.some((n) => nameIn(own, n)))
    const namesHere = who.length > 0
    // Half as much for naming only the point of view (most of the codex does), unless it is a thing: someone's sledge. An
    // event names the people in it, so it counts half again.
    const tie = (!namesHere ? 0 : e.kind === 'item' || who.some((h) => h.id !== o.povId) ? 1 : 0.5) * (e.kind === 'event' ? 0.5 : 1)
    const names = namesOf(e, heads)
    const step = names.some((n) => namedText.some((t) => nameIn(t, n))) ? 1.25 : names.some((n) => toldText.some((t) => nameIn(t, n))) ? 0.5 : 0
    const named = step > 0
    const share = overlap.get(e.id) ?? 0
    const score = (share >= TOUCH_KEEP ? 1.5 * share : 0) + (isHeld ? 1.5 : 0) + tie + step
    if (score < RELATED_KEEP) return []
    const why = isHeld ? 'held by someone here' : namesHere ? 'tied to someone here' : named ? 'tied to something here' : 'close to the scene’s words'
    return [{ e, score, why }]
  })
  scored.sort((a, b) => b.score - a.score || (KIND_ORDER[a.e.kind] ?? 3) - (KIND_ORDER[b.e.kind] ?? 3) || a.e.name.localeCompare(b.e.name))
  for (const s of scored) add(s.e.id, s.why)
  return out
}

/**
 * Who knows what, for a check: the facts the people here know or that name one of them, in the memory's order. When
 * there are more than `cap`, those that matter most are kept (Adam, 2026-10-07: the list was cut in the memory's own
 * order, so a fact about what the new words name could be left out): first a fact that names something the words being
 * checked name (an entry in `named`; an item by its main word too), then one that names someone here or that some of
 * them know and others don't, then the most lately learned. With `rank` (factRelevance, 2026-10-16), how much a fact
 * shares the scene's own words counts most (RANK_WEIGHT: a close match outweighs naming something there), before how
 * lately it was learned.
 */
export function factsThatMatter(
  facts: FactState[],
  people: EntryState[],
  named: EntryState[],
  cap: number,
  heads: Map<ID, string[]> = itemHeads([...people, ...named]),
  rank?: ReadonlyMap<ID, number>
): FactState[] {
  const ids = new Set(people.map((e) => e.id))
  const namesIn = (fact: string, list: EntryState[]): boolean => list.some((e) => namesOf(e, heads).some((n) => mentions(fact, n)))
  const things = named.filter((e) => !ids.has(e.id))
  const scored = factPool(facts, people).map((f, i) => {
    const knowers = people.filter((p) => f.knownBy.includes(p.id)).length
    const gap = knowers > 0 && knowers < people.length
    return { f, i, score: (namesIn(f.fact, things) ? 2 : 0) + (gap || namesIn(f.fact, people) ? 1 : 0) + RANK_WEIGHT * (rank?.get(f.factId) ?? 0) }
  })
  if (scored.length <= cap) return scored.map((x) => x.f)
  // Those kept, in the order the memory lists them.
  const kept = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score || (b.f.at ?? -2) - (a.f.at ?? -2) || a.i - b.i)
      .slice(0, cap)
      .map((x) => x.i)
  )
  return scored.filter((x) => kept.has(x.i)).map((x) => x.f)
}

/**
 * The facts of who knows what that the scene's own words touch, for the facts check (2026-10-16), at most `most`: those
 * `rank` scores (factRelevance) or that name something the words name that isn't a person, the most touched first.
 */
export function factsTheWordsTouch(
  facts: FactState[],
  people: EntryState[],
  named: EntryState[],
  rank: ReadonlyMap<ID, number>,
  most = FACTS_FOR_FACTS,
  heads: Map<ID, string[]> = itemHeads([...people, ...named])
): FactState[] {
  const ids = new Set(people.map((e) => e.id))
  const things = named.filter((e) => !ids.has(e.id))
  const namesThing = (fact: string): boolean => things.some((e) => namesOf(e, heads).some((n) => mentions(fact, n)))
  return factPool(facts, people)
    .map((f, i) => ({ f, i, touch: rank.get(f.factId) ?? 0, thing: namesThing(f.fact) }))
    .filter((x) => x.touch > 0 || x.thing)
    .sort((a, b) => b.touch + (b.thing ? 0.25 : 0) - (a.touch + (a.thing ? 0.25 : 0)) || (b.f.at ?? -2) - (a.f.at ?? -2) || a.i - b.i)
    .slice(0, Math.max(0, most))
    .map((x) => x.f)
}

/**
 * When an open plot thread is due, as a check is told it: "due to be paid off by the end of Ch 7", "overdue (due to be paid
 * off by the end of Ch 4)", "planned to be paid off in Ch 5, Sc 2".
 */
export function threadDueWords(due: ThreadDue | undefined): string {
  if (!due) return ''
  const when = due.from === 'card' && due.sceneLabel ? `planned to be paid off in ${due.sceneLabel}` : `due to be paid off by the end of ${due.label}`
  if (due.state === 'now') return due.from === 'card' && due.sceneLabel ? when : 'due to be paid off by the end of this chapter'
  return due.state === 'overdue' ? `overdue (${when})` : when
}

/** One open plot thread for a check: "- The drowned bell — Who rang it? — last clue: … — due to be paid off by the end of Ch 7". */
export const threadLine = (t: OpenThread): string =>
  `- ${[t.name, t.promise ? clip(t.promise, 140) : '', t.clue ? `last clue: ${clip(t.clue, 140)}` : '', threadDueWords(t.due)].filter(Boolean).join(' — ')}`

/**
 * The scene card's plan as a check is told it (2026-10-16): the author's intent, so what the card asks for (a lie, a
 * mistake) isn't taken for a slip. Its goal, conflict, beats, outcome and notes, and the plot threads it sets up or pays
 * off. '' when the card has none of these.
 */
export function planText(card: SceneCard, nameOf: (id: ID) => string | null): string {
  const beats = (card.beats ?? []).map((b) => clean(b)).filter(Boolean)
  const threads = (ids: ID[] | undefined): string => (ids ?? []).map(nameOf).filter((n): n is string => !!n).join('; ')
  return [
    clean(card.goal) ? `Goal: ${clip(card.goal, 300)}` : '',
    clean(card.conflict) ? `Conflict: ${clip(card.conflict, 300)}` : '',
    ...(beats.length ? ['Beats:', ...beats.slice(0, MOST_BEATS).map((b, i) => `${i + 1}. ${clip(b, 240)}`)] : []),
    clean(card.outcome) ? `By the end: ${clip(card.outcome, 300)}` : '',
    clean(card.notes) ? `Notes: ${clip(card.notes, 600)}` : '',
    threads(card.setsUpIds) ? `Sets up: ${threads(card.setsUpIds)}` : '',
    threads(card.paysOffIds) ? `Pays off: ${threads(card.paysOffIds)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * One fact as a check is told it (the who-knows-what ledger, long story memory fix 9): who here knows it, each with since
 * when and how ("Tobin (since Book 1, Ch 2, Sc 3; heard it from Mara)"), and who here doesn't. Never "not known by"
 * someone the fact is about, nor an animal, nor at all when who knows it doesn't rest on who was there or on Adam (B5).
 */
export function knowsLine(f: FactState, people: EntryState[], nameOf: (id: ID) => string | null): string {
  // An animal is never told as knowing anything, even where an older read kept it so.
  const knows = people
    .filter((p) => f.knownBy.includes(p.id) && isPerson(p))
    .map((p) => {
      const how = learnedWords(f.since?.[p.id], nameOf)
      return how ? `${p.name} (${how})` : p.name
    })
  const not =
    f.backed === false ? [] : people.filter((p) => !f.knownBy.includes(p.id) && isPerson(p) && !namesPerson(f.fact, p)).map((p) => p.name)
  return `${clean(f.fact)} Known by: ${knows.join(', ') || 'none of them'}.${not.length ? ` Not known by: ${not.join(', ')}.` : ''}`
}

/**
 * What these people believe that isn't true as the scene begins (fix 9), the most lately come to first, at most `most`:
 * "Tobin wrongly believes: The letter is genuine (since Book 1, Ch 1, Sc 2). It isn't true."
 */
export function beliefLines(beliefs: BeliefState[] | undefined, people: EntryState[], nameOf: (id: ID) => string | null, most = MOST_BELIEFS): string[] {
  const byId = new Map(people.filter(isPerson).map((p) => [p.id, p]))
  return (beliefs ?? [])
    .flatMap((b) =>
      b.believedBy.flatMap((id) => {
        const p = byId.get(id)
        const fact = clean(b.fact).replace(/[.]+$/, '')
        return p && fact ? [{ p, fact, since: b.since[id] ?? null, at: b.since[id]?.at ?? b.at }] : []
      })
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, most)
    .map(({ p, fact, since }) => {
      const how = learnedWords(since, nameOf)
      return `${p.name} wrongly believes: ${fact}${how ? ` (${how})` : ''}. It isn't true.`
    })
}

/** Names of anyone the memory knows at the scene, for who told whom. */
export const namesAt = (memory: Pick<SceneMemory, 'entries' | 'elsewhere'>): ((id: ID) => string | null) => {
  const names = new Map<ID, string>([...memory.elsewhere.map((x) => [x.entry.id, x.entry.name] as const), ...memory.entries.map((e) => [e.id, e.name] as const)])
  return (id) => names.get(id) ?? null
}

/**
 * What these characters gave away, lost or got however long ago, as of the scene's start (memory/items.ts), the items
 * `text` names first.
 */
export function holdingsHere(memory: Pick<SceneMemory, 'entries' | 'relationships'>, people: ID[], text: string): Holding[] {
  return holdingsFirst(holdingsOf({ entries: memory.entries, relationships: memory.relationships, people }), text)
}

/** Each item's own main words, among every entry the memory knows at the scene (memory/items.ts itemHeads). */
export const headsAt = (memory: Pick<SceneMemory, 'entries' | 'elsewhere'>): Map<ID, string[]> =>
  itemHeads([...memory.entries, ...memory.elsewhere.map((x) => x.entry)])

/** Where any of the names first appears in the text as a whole word (as the briefing reads names), or -1. */
function firstMention(text: string, names: string[]): number {
  let best = -1
  for (const n of names) {
    const name = n.trim()
    if (name.length < 2 || !mentions(text, name)) continue
    const at = text.search(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}`, 'iu'))
    if (at >= 0 && (best < 0 || at < best)) best = at
  }
  return best
}

// ---------- The request ----------

/** One section of a request, as "What the AI saw" lists it. */
export interface Section {
  id: string
  title: string
  text: string
  entryIds: ID[]
}

const kindWord = (e: EntryState): string => KIND_LABELS[e.kind]?.one.toLowerCase() ?? 'entry'

/** An entry's fields that say what is meant to come, not what is so: never told to a check as the memory. */
const PLAN_FIELDS: readonly string[] = ['arcStart', 'arcEnd']

/**
 * An entry as the check sees it: its profile and what has happened to it so far ("short": a line and its looks). Told in
 * full, its backstory too (checkfix, 2026-10-20): key past events, origin and secrets, and a place's geography and history,
 * which the briefing's short form leaves out. That is where the memory keeps how someone's parents died or how far a town
 * lies ("her father drowned eleven winters ago below Corran Weir", "four days north of Callowmere"), what the facts check
 * compares a scene's words about the past with. Never the arc's planned start and end.
 */
export function entryText(c: CheckEntry, short = false): string {
  const e = c.entry
  const notes = [kindWord(e), c.why, c.label].filter(Boolean).join('; ')
  const heading = `### ${c.code} ${e.name} (${notes})`
  if (short) {
    const looks = formatProfile(e, null, ['looks']).split('\n').filter((l) => l.startsWith('- '))
    return [heading, clean(e.summary), ...looks, happenedText(e, 3)].filter(Boolean).join('\n')
  }
  const fields = Object.fromEntries(Object.entries(e.fields ?? {}).filter(([k]) => !PLAN_FIELDS.includes(k)))
  return [formatProfile({ ...e, fields }, heading), happenedText(e, 8)].filter(Boolean).join('\n\n')
}

/** The heading of the facts of who knows what the scene's words touch, the facts check's own list. */
export const TOUCHED_TITLE = 'What people here know that this scene touches'

/** The sections a request about these checks needs (everything but the scene's text). */
export function checkSections(ctx: SceneCheckContext, checks: CheckKind[], short = false): Section[] {
  const out: Section[] = []
  const has = (c: CheckKind): boolean => checks.includes(c)
  const byId = new Map(ctx.entries.map((c) => [c.entry.id, c]))
  const ref = (id: ID | null | undefined): string => {
    const c = id ? byId.get(id) : undefined
    return c ? `${c.code} ${c.entry.name}` : ''
  }

  const card = ctx.card
  const isSo = has('facts') || has('knowledge') || has('timeline') || has('continuity')
  // The story calendar's sums (long story memory fix 11): the scene's date and how long since the scene before.
  const dates = isSo
    ? storyDateLines({ scene: { card }, memory: ctx.memory, calendar: ctx.calendar }).filter((l) => /^(?:Story date|Ages here):/.test(l))
    : []
  const cardLines = [
    `Scene: ${ctx.where}${ctx.title ? ` "${ctx.title}"` : ''}`,
    card.when.trim() ? `When: ${card.when.trim()}` : '',
    ...dates,
    ref(card.locationId) ? `Where: ${ref(card.locationId)}` : '',
    ref(card.povId) ? `Point of view: ${ref(card.povId)}` : '',
    card.presentIds?.length ? `Present: ${card.presentIds.map(ref).filter(Boolean).join(', ')}` : '',
    card.mood.trim() && (has('style') || has('voice')) ? `Mood: ${card.mood.trim()}` : ''
  ].filter(Boolean)
  out.push({ id: 'scene-card', title: 'The scene card', text: cardLines.join('\n'), entryIds: [] })

  // The author's plan (2026-10-16): what the card asks for is meant, never a slip.
  const nameOfEntry = (id: ID): string | null => ctx.memory.entries.find((e) => e.id === id)?.name ?? null
  const plan = planText(card, nameOfEntry)
  if (plan) out.push({ id: 'plan', title: "The author's plan for this scene", text: plan, entryIds: [] })

  if (has('style')) {
    const s = ctx.style
    const lines = [
      s.pov ? `Point of view: ${s.pov}` : '',
      s.tense ? `Tense: ${s.tense}` : '',
      s.proseStyle ? `Prose style: ${s.proseStyle}` : '',
      s.tone ? `The story's tone: ${s.tone}` : '',
      s.genre ? `Genre: ${s.genre}` : '',
      ...(s.content ?? [])
    ].filter(Boolean)
    if (lines.length) out.push({ id: 'style', title: 'The style guide', text: lines.join('\n'), entryIds: [] })
  }
  if (ctx.style.strong && checks.some((c) => c !== 'style')) {
    // The other checks are told the story means its strong content too, so they read such a scene as they would any other
    // (in the material every request about the scene shares, whichever of them it makes: 2026-10-19).
    out.push({ id: 'content', title: 'About this story', text: ctx.style.strong, entryIds: [] })
  }

  const full = short ? [] : ctx.entries.slice(0, MOST_FULL)
  const brief = ctx.entries.filter((c) => !full.includes(c))
  const entryLines = [...full.map((c) => entryText(c)), ...brief.map((c) => entryText(c, true))]
  out.push({
    id: 'memory',
    title: 'The memory as of the start of this scene',
    text: entryLines.length ? entryLines.join('\n\n') : 'Nothing in the memory is named in this scene.',
    entryIds: ctx.entries.map((c) => c.entry.id)
  })

  if (has('facts') || has('knowledge') || has('timeline')) {
    const rels = ctx.memory.relationships.filter((r) => byId.has(r.aId) && byId.has(r.bId))
    if (rels.length) {
      const name = (id: ID): string => byId.get(id)!.entry.name
      out.push({
        id: 'relationships',
        title: 'Relationships',
        text: rels
          .map((r) =>
            [
              `${name(r.aId)} and ${name(r.bId)}: ${clean(r.type) || 'linked'}.`,
              clean(r.aFeels) ? `${name(r.aId)} feels: ${clean(r.aFeels)}.` : '',
              clean(r.bFeels) ? `${name(r.bId)} feels: ${clean(r.bFeels)}.` : ''
            ]
              .filter(Boolean)
              .join(' ')
          )
          .join('\n'),
        entryIds: []
      })
    }
  }

  const characters = ctx.entries.filter((c) => c.entry.kind === 'character' && !c.label)
  // How much each fact shares the scene's own words (gathered with the scene; worked out here for a context made by hand).
  const rank = ctx.factRank ?? factRelevance(factPool(ctx.memory.facts, characterStates(ctx.entries)), ctx.text, personNames(ctx.entries))
  // What the card and the words name (not the entries only tied to the scene): a fact naming one of them matters here.
  const cardOrWords = ctx.entries.filter((c) => !RELATED_WHYS.includes(c.why)).map((c) => c.entry)
  const people = characters.map((c) => c.entry)
  const nameOf = namesAt(ctx.memory)
  // The facts check's own list (2026-10-16): what people here know that the scene's words touch, so what the scene says
  // about the past (who heard what, how someone died, how far a place is) can be checked against it. Its own section again
  // (checkfix, 2026-10-20): since the requests shared their material (2026-10-19) these were only added to the end of who
  // knows what, or left where they stood among its 40 lines ("Pim cannot read words" 33rd of 42), and the facts check
  // passed the slips the released app caught from this short list.
  const touched = has('facts') ? factsTheWordsTouch(ctx.memory.facts, people, cardOrWords, rank, FACTS_FOR_FACTS, headsAt(ctx.memory)) : []
  if (touched.length) {
    out.push({ id: 'touched', title: TOUCHED_TITLE, text: touched.map((f) => `- ${knowsLine(f, people, nameOf)}`).join('\n'), entryIds: [] })
  }
  if (has('knowledge')) {
    // The facts that matter most to this scene, when there are more than the list holds (factsThatMatter), without those
    // listed above: the same facts as before, each told once.
    const above = new Set(touched.map((f) => f.factId))
    const facts = factsThatMatter(ctx.memory.facts, people, cardOrWords, MOST_FACTS, headsAt(ctx.memory), rank).filter((f) => !above.has(f.factId))
    // Each knower with since when and how, as the who-knows-what ledger has it (fix 9).
    const lines = facts.map((f) => `- ${knowsLine(f, people, nameOf)}`)
    // What those here believe that isn't true: acting on the truth of it before the story shows them learning it is a slip.
    const wrong = beliefLines(ctx.memory.beliefs, people, nameOf)
    const known = lines.length
      ? `${touched.length ? `Besides what is listed under "${TOUCHED_TITLE}":\n` : ''}${lines.join('\n')}`
      : touched.length
        ? `Nothing besides what is listed under "${TOUCHED_TITLE}".`
        : 'The memory lists nothing that these characters know.'
    out.push({
      id: 'knowledge',
      title: 'Who knows what at the start of this scene',
      text: [known, wrong.length ? `What some of them believe that isn't true:\n${wrong.map((l) => `- ${l}`).join('\n')}` : ''].filter(Boolean).join('\n\n'),
      entryIds: []
    })
  }

  // Plot threads still open, with when each is due (the promises ledger, long story memory fix 10): a scene that pays one
  // off early, or treats one as settled, goes against them.
  if (has('facts') || has('knowledge') || has('timeline')) {
    const threads = openThreadsAt(ctx.memory, card, short ? Math.ceil(MOST_THREADS / 2) : MOST_THREADS)
    if (threads.length) out.push({ id: 'threads', title: 'Plot threads still open', text: threads.map(threadLine).join('\n'), entryIds: [] })
  }

  // The story so far (Adam, 2026-10-04: check against what happened long before, not only the last few scenes).
  if (has('facts') || has('knowledge') || has('timeline') || has('continuity')) {
    const sofar = short ? ctx.storySoFar.short : ctx.storySoFar.full
    if (sofar.trim()) out.push({ id: 'story-so-far', title: 'The story so far', text: sofar, entryIds: [] })
  }

  // Who is dead by now: the facts check's first question.
  if (has('facts') || has('continuity')) {
    const dead = deadBy(ctx.memory.entries)
    if (dead.length) out.push({ id: 'dead', title: 'Dead at the start of this scene', text: dead.map((d) => `- ${d.name}: ${d.note}`).join('\n'), entryIds: [] })
  }

  // What the characters here gave away, lost or got, however long ago (Adam, 2026-10-07: a compass given away chapters
  // before was taken out of a pocket): only what is true now, the items the scene names first.
  if (has('facts') || has('continuity')) {
    const owned = holdingsHere(
      ctx.memory,
      characters.map((c) => c.entry.id),
      ctx.text
    ).slice(0, MOST_OWNED)
    if (owned.length) {
      out.push({ id: 'owned', title: 'What people here no longer have, or have now', text: owned.map((h) => `- ${holdingLine(h)}`).join('\n'), entryIds: [] })
    }
  }

  // What the author said is meant when a check raised it in an earlier scene (fix 7 of the long story memory research):
  // the same thing here is no issue either. Only for the checks being run.
  // At most MOST_MEANT for each of CHECK_GROUPS' requests, as each was told when it had its own material.
  const told = CHECK_GROUPS.map(() => 0)
  const meant = (ctx.meant ?? []).filter((l) => {
    const check = MEANT_CHECK[l.kind]
    if (!check || !has(check)) return false
    const g = Math.max(0, CHECK_GROUPS.findIndex((x) => x.includes(check)))
    return told[g]++ < MOST_MEANT
  })
  if (meant.length) {
    out.push({
      id: 'meant',
      title: 'What the author has said is meant',
      text: meant.map((l) => `- ${lessonLine(l)}`).join('\n'),
      entryIds: []
    })
  }

  // Where things stood as the previous scene ended: the continuity check's starting point.
  if (has('continuity')) {
    const stand = ctx.continuity ? stateText(ctx.continuity) : ''
    out.push({
      id: 'continuity',
      title: 'Where things stood as the previous scene ended',
      text: stand || 'Nothing is known yet about where things stood (this may be the opening scene).',
      entryIds: []
    })
  }

  if (has('timeline')) {
    if (ctx.earlier.length) {
      out.push({
        id: 'earlier',
        title: 'The scenes just before this one',
        text: ctx.earlier
          .map((s) =>
            [
              `${s.code} ${s.label}${s.title ? ` "${s.title}"` : ''}`,
              s.when ? `When: ${s.when}` : '',
              s.place ? `Where: ${s.place}` : '',
              s.present.length ? `Present: ${s.present.join(', ')}` : '',
              s.summary && !short ? `What happens: ${s.summary}` : ''
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n\n'),
        entryIds: []
      })
    }
    const prev = ctx.memory.previous
    if (prev?.text.trim() && !short) {
      out.push({ id: 'previous-scene', title: 'How the scene before ends', text: sceneTail(prev.text, SHORT_TAIL), entryIds: [] })
    }
  }
  return out
}

/** One request: its messages, and its blocks for "What the AI saw". */
export interface CheckRequest {
  user: string
  blocks: ContextBlock[]
  entryIds: ID[]
  /**
   * How much of `user` is its opening (the material and the scene's words), which every request about this part of the
   * scene starts with: what a provider's cache serves, and what a model that caches only where asked is told to keep.
   */
  opening: number
}

/** A section as a request says it: "## Title" and its text. */
export const sectionText = (s: Pick<Section, 'title' | 'text'>): string => `## ${s.title}\n${s.text}`

/**
 * The opening of every request about a part of the scene ("part" is 1-based; parts is how many there are): the material
 * (`sections`), then the scene's words, the same bytes in the same order whatever the request then asks (2026-10-19).
 */
export function checkOpening(sections: Section[], part: string, n: { part: number; parts: number }): Omit<CheckRequest, 'opening'> {
  const title = n.parts > 1 ? `The scene (part ${n.part} of ${n.parts})` : 'The scene'
  const all = [...sections, { id: 'scene-text', title, text: part, entryIds: [] }]
  const blocks: ContextBlock[] = all.map((s, i) => ({
    id: s.id,
    priority: Math.min(10, i + 1),
    title: s.title,
    text: s.text,
    tokens: estimateTokens(s.text),
    entryIds: s.entryIds,
    dropped: false
  }))
  return { user: all.map(sectionText).join('\n\n'), blocks, entryIds: [...new Set(sections.flatMap((s) => s.entryIds))] }
}

/** The request for a part of the scene: its opening, then its own task (checks/prompts.ts checkTask) last. */
export function checkRequest(sections: Section[], part: string, n: { part: number; parts: number }, task = ''): CheckRequest {
  const open = checkOpening(sections, part, n)
  if (!task) return { ...open, opening: open.user.length }
  const block: ContextBlock = { id: 'task', priority: 10, title: 'The task', text: task, tokens: estimateTokens(task), entryIds: [], dropped: false }
  return { ...open, user: `${open.user}\n\n${task}`, blocks: [...open.blocks, block], opening: open.user.length }
}

/**
 * The scene's text in parts that fit `tokens` each, cut between paragraphs (a paragraph too long on its
 * own is cut between sentences). One part when it all fits.
 */
export function splitScene(text: string, tokens: number): string[] {
  if (estimateTokens(text) <= tokens) return [text]
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  let cur: string[] = []
  let used = 0
  const flush = (): void => {
    if (cur.length) out.push(cur.join('\n\n'))
    cur = []
    used = 0
  }
  for (const p of paras) {
    const size = estimateTokens(p)
    if (size > tokens) {
      flush()
      out.push(...splitLongPara(p, tokens))
      continue
    }
    if (used + size > tokens) flush()
    cur.push(p)
    used += size
  }
  flush()
  return out.length ? out : [text]
}

function splitLongPara(p: string, tokens: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const s of p.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/gu) ?? [p]) {
    if (cur && estimateTokens(cur + s) > tokens) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** The genre picks for the style check: "Horror (slow-building dread)", or "" when none is picked. */
function genreText(ids: string[]): string {
  const label = genreLabel(ids)
  return label ? `${label} (${genresOf(ids).map((g) => g.feel).join('; ')})` : ''
}
