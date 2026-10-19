// The card check before writing (2026-10-19): before a scene is planned, its card is held to the story index, with no AI
// call. A stand-in test found cards that said what the story so far didn't allow: "Where: The Drove Road" for a scene at an
// inn on the coast road where everyone had just been; a case still in someone's hands after it was filed with the court;
// a character's age on the card that contradicted his entry. What is found goes (a) into what the planner is given, as
// "Before writing, note: …" lines, so the plan resolves them (plan/core.ts notes, plan.ts planMessages), and (b) to Adam:
// in the plan-first review (plan/review.ts) and on the plan's record in What the AI saw ("Steps it took").
//
// Each says nothing unless the index is sure:
// - place: someone on the card was last somewhere the road from which takes longer than the cards' times allow (the story
//   index's too-fast check for this scene, storyIndex/checks.ts, unless the story's words have moved them on since); or
//   the card’s beats (or Adam's direction) have someone on the card at the place the story last had them, a place apart from
//   the card's Where (never a sentence of going, coming or remembering);
// - person: someone on the card the memory is sure has died (after-death), or who is somewhere else at that very moment
//   (same-moment);
// - thing: something the card’s beats or the direction have someone use that the index has elsewhere, left in another
//   place or carried by someone not here (plan/preconditions.ts beatsCanHappen, its findings that can't be put right), or
//   that the memory says they no longer have (gave it away, lost it, had it taken: memory/items.ts holdingsOf), unless
//   someone here has it now or the card has them get it back;
// - time: the card’s When is earlier than the scene before it and doesn’t say it goes back (memory/storyCalendar.ts
//   scenesGoingBack);
// - age: the card gives someone an age a year or more from what their entry works out to here (checks/rules.ts ageGiven,
//   memory/storyCalendar.ts ageHere; with no dates to count by, their entry's age as given, two years either way).
// Place and time are about how a scene begins: carrying on (Add below), only the person and thing checks run. Never names
// what Adam kept out of the scene's briefing. Reads the database; no Electron imports.

import type Database from 'better-sqlite3'
import type { EntryState, ID, RelationshipState, SceneCard } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { findName, namedInProse } from '@shared/names'
import * as sidx from '../db/storyIndex'
import { indexChecks, stateOf } from '../storyIndex'
import { ageHere, calendarOfScene, scenesGoingBack } from '../memory/storyCalendar'
import { ageWords, dateLabel, readAge, type AgeAt } from '../memory/calendar'
import { ageClashes, ageGiven, dreamlikeCard } from '../checks/rules'
import { holdingsOf, namesItem, type Holding } from '../memory/items'
import { shortPlace } from '../ai/mustStay'
import { directionAsks } from '../ai/contract'
import { clip } from '../ai/lookups/text'
import { beatsCanHappen, FETCH, USE_WORD, type BeatWorld } from './preconditions'

type DB = Database.Database

export type CardFindingKind = 'place' | 'person' | 'thing' | 'time' | 'age'

/** One thing the card says that the story so far doesn't allow, in plain words. */
export interface CardFinding {
  kind: CardFindingKind
  text: string
  /** Who or what it is about, when it is one entry. */
  entryId?: ID
}

/** Everything the card is held to. */
export interface CardWorld {
  db: DB
  storyId: ID
  sceneId: ID
  card: SceneCard
  /** Adam's direction for this draft ('' for none). */
  direction: string
  /** The memory's entries as they are at this scene (ages, other names, what someone has or no longer has). */
  entries: readonly EntryState[]
  relationships: readonly RelationshipState[]
  /** Everyone in the scene (plan/core.ts present: the card, and whoever the stage and the words put there). */
  present: readonly ID[]
  /** A whole scene, read as it begins; false: carrying on from its words (Add below). */
  asItBegins: boolean
  stand?: SceneState | null
  soFar?: string
  /** What Adam kept out of the scene's briefing: never named. */
  hidden?: ReadonlySet<ID>
  /** The story's title, left off where something happened ("Ch 2, Sc 7"). */
  storyTitle?: string
}

/** How each line starts, for the planner and for Adam. */
export const CARD_NOTE = 'Before writing, note:'
/** The most findings one card gets. */
export const CARD_CHECK_MOST = 8
export { CARD_CHECK_LABEL } from './plan'

/** The findings as the planner and Adam read them: "Before writing, note: …". */
export const cardNoteLines = (found: readonly CardFinding[]): string[] => found.map((f) => `${CARD_NOTE} ${f.text}`)

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const ended = (s: string): string => (/[.!?…]["'”’)\]]*$/.test(s) ? s : `${s}.`)
/** The sentences of a text. */
const sentences = (text: string): string[] =>
  clean(text)
    .split(/(?<=[.!?…])\s+(?=["'“‘(]?\p{Lu})/u)
    .map((s) => s.trim())
    .filter(Boolean)

/** Going, coming or travelling: a sentence of these names a place on the way, not where the scene is. */
const MOVES =
  /\b(?:to|towards?|from|into|leav\w*|left|rid(?:e|es|ing)|rode|walk\w*|travel\w*|journey\w*|return\w*|back|arriv\w*|reach\w*|head(?:s|ed|ing)? (?:for|off|out|back|north|south|east|west)|set(?:s|ting)? (?:out|off)|away|bound for|flee\w*|fled|escape\w*)\b/i
/** Remembering, dreaming, writing or hearing of a place: not being there. */
const ELSEWHERE_IN_MIND =
  /\b(?:remember\w*|recall\w*|thinks? (?:of|about)|thought (?:of|about)|dream\w*|memor(?:y|ies)|imagin\w*|letters?|news|word (?:from|of)|wr(?:ite|ites|ote|itten)|hears? (?:of|about|from)|heard (?:of|about|from)|talks? (?:of|about)|talked (?:of|about)|tells? of|told of|story of)\b/i
/** Being somewhere: "in The Gull Inn", "at the Gull". */
const BEING_AT = /\b(?:at|in|inside|within)\s+(?:the\s+)?$/i

/** True when two places are apart: neither is the other, nor inside it. */
function apart(a: ID, b: ID, parents: ReadonlyMap<ID, ID | null>): boolean {
  if (a === b) return false
  const within = (x: ID, y: ID): boolean => {
    const seen = new Set<ID>()
    for (let p = parents.get(x) ?? null; p && !seen.has(p); p = parents.get(p) ?? null) {
      if (p === y) return true
      seen.add(p)
    }
    return false
  }
  return !within(a, b) && !within(b, a)
}

/** The names a place or a person goes by. */
const namesOf = (e: Pick<EntryState, 'name' | 'aliases'> | undefined | null, fallback = ''): string[] =>
  [e?.name ?? fallback, ...(e?.aliases ?? [])].map(clean).filter((n) => n.length >= 2)

/** True when a sentence has someone at a place: one of its names after "at", "in", "inside" or "within". */
function beingAt(sentence: string, names: readonly string[]): boolean {
  for (const n of names) {
    let from = 0
    for (;;) {
      const f = findName(sentence.slice(from), n)
      if (!f) break
      if (BEING_AT.test(sentence.slice(Math.max(0, from + f.start - 16), from + f.start))) return true
      from += f.end
    }
  }
  return false
}

/** The card's own lines a check reads, each with how a finding names it. */
interface Said {
  /** "the card’s beat 2 (“…”)", "your direction (“…”)", "the card". */
  where: string
  text: string
  /** A beat (by its index), else the card's goal or outcome, or the direction. */
  beat?: number
}

function saidOn(card: SceneCard, direction: string): Said[] {
  const out: Said[] = []
  ;(card.beats ?? []).forEach((b, i) => {
    const t = clean(b)
    if (t) out.push({ where: `the card’s beat ${i + 1} (“${clip(t, 100)}”)`, text: t, beat: i })
  })
  for (const t of [card.goal, card.outcome].map(clean).filter(Boolean)) out.push({ where: `the card (“${clip(t, 100)}”)`, text: t })
  for (const a of directionAsks(clean(direction)).filter((x) => x.kind === 'event')) out.push({ where: `your direction (“${clip(a.text, 100)}”)`, text: a.text })
  return out
}

/** Who is on the card: its point of view and its people, characters only, not kept out. */
function cardPeople(w: CardWorld): EntryState[] {
  const byId = new Map(w.entries.map((e) => [e.id, e]))
  return [...new Set([w.card.povId, ...(w.card.presentIds ?? [])])]
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((e): e is EntryState => !!e && e.kind === 'character' && !w.hidden?.has(e.id))
}

/**
 * The card held to the story so far (see the top of this file): what it says that the story doesn't allow, in plain
 * words, at most CARD_CHECK_MOST. Nothing when the scene isn't in the story index. Never throws: a check that can't read
 * what it needs says nothing.
 */
export function cardCheck(w: CardWorld): CardFinding[] {
  const scene = sidx.indexScene(w.db, w.sceneId)
  if (!scene || scene.storyId !== w.storyId) return []
  const out: CardFinding[] = []
  const add = (f: CardFinding): void => {
    if (out.length < CARD_CHECK_MOST && !out.some((x) => x.text === f.text)) out.push(f)
  }
  const people = cardPeople(w)
  const said = saidOn(w.card, w.direction)
  const dreamlike = dreamlikeCard(w.card)
  const quietly = <T>(what: string, fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch (e) {
      console.warn(`The card check couldn't read ${what}`, e)
      return fallback
    }
  }
  if (!dreamlike) {
    for (const f of quietly('the story index’s checks', () => fromIndexChecks(w, people), [])) add(f)
    if (w.asItBegins) for (const f of quietly('where people were last', () => beatsElsewhere(w, scene.position, people, said), [])) add(f)
    for (const f of quietly('the things the card uses', () => thingsElsewhere(w, said), [])) add(f)
    for (const f of quietly('what people no longer have', () => noLongerHas(w, people, said, out), [])) add(f)
    if (w.asItBegins) for (const f of quietly('the story calendar', () => timeGoesBack(w), [])) add(f)
  }
  for (const f of quietly('ages', () => agesOnCard(w, people), [])) add(f)
  return out
}

/** The story index's own checks of this scene’s card: someone dead, somewhere else at that moment, or there too soon. */
function fromIndexChecks(w: CardWorld, people: readonly EntryState[]): CardFinding[] {
  const on = new Set(people.map((p) => p.id))
  const out: CardFinding[] = []
  for (const f of indexChecks(w.db, w.storyId)) {
    if (f.sceneId !== w.sceneId || !on.has(f.entryId)) continue
    const name = people.find((p) => p.id === f.entryId)?.name ?? ''
    if (f.check === 'after-death') {
      const died = sidx.indexScene(w.db, f.otherSceneId)?.label
      out.push({
        kind: 'person',
        entryId: f.entryId,
        text: `${name} died${died ? ` in ${died}` : ''}, but this scene’s card has ${name} there. The dead may be remembered, talked of or found here, never act.`
      })
      continue
    }
    if (!w.asItBegins) continue
    if (f.check === 'same-moment') {
      out.push({ kind: 'person', entryId: f.entryId, text: `${ended(f.message)} ${name} can’t be in both.` })
      continue
    }
    if (f.check === 'too-fast' && !movedOnSince(w, f.entryId, f.otherSceneId)) {
      out.push({ kind: 'place', entryId: f.entryId, text: `${ended(f.message)} Either time has passed on the way, or ${name} isn’t there yet.` })
    }
  }
  return out.filter((f) => f.text.trim() && !hiddenIn(w, f.text))
}

/**
 * True when the story's words may have moved someone on since the scene their card last placed them in: the index's latest
 * word on where they are is the words' own, and is from a later scene without naming that scene's place, or names another
 * place apart from it ("on the coast road" said in the same scene; never "in the taproom", which is somewhere in it).
 */
function movedOnSince(w: CardWorld, entryId: ID, fromSceneId: ID): boolean {
  const now = stateOf(w.db, w.storyId, entryId, w.sceneId, { asItBegins: true })
  const place = now?.place
  if (!place || place.lastSeen || place.origin === 'card') return false
  const from = sidx.indexScene(w.db, fromSceneId)
  const since = sidx.indexScene(w.db, place.sinceSceneId)
  if (!from || !since || since.position < from.position) return false
  const placeId = from.placeEntryId
  const names = placeId ? namesOf(w.entries.find((e) => e.id === placeId), sidx.entryNames(w.db, [placeId]).get(placeId)?.name) : []
  if (names.some((n) => namedInProse(place.value, n))) return false
  if (since.position > from.position) return true
  const parents = sidx.placeParents(w.db)
  return w.entries.some((e) => e.kind === 'place' && (!placeId || apart(e.id, placeId, parents)) && namesOf(e).some((n) => namedInProse(place.value, n)))
}

/**
 * The card’s beats (or the direction) have someone on the card at the place the story last had them, a place apart from
 * the card's own Where: "Where: The Drove Road", and "Mara waits in the Gull Inn's taproom" just after Mara was there.
 */
function beatsElsewhere(w: CardWorld, position: number, people: readonly EntryState[], said: readonly Said[]): CardFinding[] {
  const here = w.card.locationId || null
  if (!here || !said.length) return []
  const parents = sidx.placeParents(w.db)
  const out: CardFinding[] = []
  const done = new Set<ID>()
  for (const p of people) {
    const seen = sidx.lastPresentBefore(w.db, w.storyId, p.id, position)
    const there = seen?.placeEntryId
    if (!seen || !there || done.has(there) || w.hidden?.has(there) || !apart(there, here, parents)) continue
    const now = stateOf(w.db, w.storyId, p.id, w.sceneId, { asItBegins: true })
    if (now?.dead) continue
    if (movedOnSince(w, p.id, seen.sceneId)) continue
    const known = sidx.entryNames(w.db, [there, here])
    const placeNames = namesOf(w.entries.find((e) => e.id === there), known.get(there)?.name)
    const line = said.find(
      (s) =>
        sentences(s.text).some((t) => beingAt(t, placeNames) && !MOVES.test(t) && !ELSEWHERE_IN_MIND.test(t)) &&
        // The person is in it, or it is the point of view's scene and no one else on the card is named.
        (namesOf(p).some((n) => namedInProse(s.text, n)) || (w.card.povId === p.id && !people.some((o) => o.id !== p.id && namesOf(o).some((n) => namedInProse(s.text, n)))))
    )
    if (!line) continue
    done.add(there)
    const cardPlace = known.get(here)?.name ?? 'another place'
    const at = known.get(there)?.name ?? placeNames[0]
    out.push({
      kind: 'place',
      entryId: there,
      text: `This card puts the scene at ${cardPlace}, but ${line.where} has ${p.name} at ${at}, where the story last had ${p.name} (${seen.label}). One of the two is wrong.`
    })
  }
  return out
}

/** Things the card’s beats or the direction have someone use that the story index has elsewhere (beatsCanHappen's flags). */
function thingsElsewhere(w: CardWorld, said: readonly Said[]): CardFinding[] {
  const base: Omit<BeatWorld, 'calls'> = {
    db: w.db,
    storyId: w.storyId,
    sceneId: w.sceneId,
    asItBegins: w.asItBegins,
    card: w.card,
    present: w.present,
    entries: w.entries,
    ...(w.stand !== undefined ? { stand: w.stand } : {}),
    ...(w.soFar ? { soFar: w.soFar } : {}),
    ...(w.hidden ? { hidden: w.hidden } : {})
  }
  const beats = said.filter((s) => s.beat !== undefined).map((s) => s.text)
  const asks = said.filter((s) => s.where.startsWith('your direction')).map((s) => s.text)
  const out: CardFinding[] = []
  // The card’s beats, with the direction as what may bring a thing or a person; then the direction, with the card’s beats.
  if (beats.length) {
    for (const f of beatsCanHappen({ ...base, calls: asks.join('\n') }, { beats, changes: [] }).flags) {
      out.push({ kind: kindOf(f), text: f.replace(/^Beat (\d+) \(/, "The card’s beat $1 (") })
    }
  }
  if (asks.length) {
    for (const f of beatsCanHappen({ ...base, calls: [...beats, clean(w.card.goal), clean(w.card.outcome)].join('\n') }, { beats: asks, changes: [] }).flags) {
      out.push({ kind: kindOf(f), text: f.replace(/^Beat \d+ \(/, 'Your direction (') })
    }
  }
  return out
}

/** A finding of beatsCanHappen is about a person when it says they aren't in the scene, else a thing. */
const kindOf = (flag: string): CardFindingKind => (/ isn’t in this scene: its card doesn’t bring them/.test(flag) ? 'person' : 'thing')

/**
 * What someone on the card no longer has, as the memory tells it (gave it away, lost it, had it taken), that the card's
 * beats or the direction have them use, unless someone on the card has it now or the card has them get it back.
 */
function noLongerHas(w: CardWorld, people: readonly EntryState[], said: readonly Said[], already: readonly CardFinding[]): CardFinding[] {
  if (!people.length || !said.length) return []
  const holdings = holdingsOf({ entries: [...w.entries], relationships: [...w.relationships], people: people.map((p) => p.id) })
  const gone = holdings.filter((h) => !h.has && !w.hidden?.has(h.itemId))
  if (!gone.length) return []
  const out: CardFinding[] = []
  const done = new Set<string>()
  for (const h of gone) {
    if (holdings.some((x) => x.itemId === h.itemId && x.has)) continue
    if (done.has(h.itemId) || already.some((f) => namesItem(f.text, h))) continue
    const p = people.find((x) => x.id === h.personId)
    if (!p) continue
    const others = people.filter((o) => o.id !== p.id)
    const at = said.findIndex(
      (s) =>
        namesItem(s.text, h) &&
        USE_WORD.test(s.text) &&
        !FETCH.test(s.text) &&
        (namesOf(p).some((n) => namedInProse(s.text, n)) || (w.card.povId === p.id && !others.some((o) => namesOf(o).some((n) => namedInProse(s.text, n)))))
    )
    if (at < 0) continue
    // An earlier beat, or the card or the direction, has them get it back.
    if (said.slice(0, at).some((s) => FETCH.test(s.text) && namesItem(s.text, h))) continue
    if (said.some((s) => s.beat === undefined && FETCH.test(s.text) && namesItem(s.text, h))) continue
    done.add(h.itemId)
    out.push({ kind: 'thing', entryId: h.itemId, text: `${capital(said[at].where)} has ${p.name} use ${h.item}, but ${p.name} no longer has it (${howOf(h, w.storyTitle)}).` })
  }
  return out
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const howOf = (h: Holding, title = ''): string => {
  const where = h.where ? shortPlace(h.where, title) : ''
  return [clean(h.how).replace(/[.]+$/, ''), where ? `since ${where}` : ''].filter(Boolean).join('; ')
}

/** The card’s When is earlier than the scene before it, and doesn’t say it goes back in time. */
function timeGoesBack(w: CardWorld): CardFinding[] {
  const back = scenesGoingBack(w.db, w.storyId).find((b) => b.sceneId === w.sceneId)
  if (!back) return []
  const cal = calendarOfScene(w.db, w.sceneId)
  const before = sidx.indexScene(w.db, back.beforeId)
  const was = dateLabel(cal?.dates.get(back.beforeId))
  const when = clean(w.card.when)
  if (!before) return []
  return [
    {
      kind: 'time',
      text: `This card’s When${when ? ` (“${when}”)` : ''} is earlier than ${before.label}${was ? ` (${was})` : ''}, the scene before it, and the card doesn’t say the scene goes back in time.`
    }
  ]
}

/** An age the card (or the direction) gives someone on it, a year or more from what their entry works out to here. */
function agesOnCard(w: CardWorld, people: readonly EntryState[]): CardFinding[] {
  const text = [w.card.notes, ...(w.card.beats ?? []), w.card.goal, w.card.conflict, w.card.outcome, w.direction].map(clean).filter(Boolean).join('\n')
  if (!text) return []
  const cal = calendarOfScene(w.db, w.sceneId)
  const out: CardFinding[] = []
  for (const p of people) {
    const years = ageGiven(text, namesOf(p))
    if (years === null) continue
    const counted = cal ? ageHere(cal, p, w.sceneId) : null
    // With no dates to count by: the entry's age as given, two years either way.
    const fact = counted ? null : readAge(p.fields?.age)
    const was: { age: AgeAt; basis: string } | null = counted
      ? counted
      : fact?.kind === 'age' && !fact.at
        ? { age: { lo: fact.years, hi: fact.years, about: true }, basis: String(fact.years) }
        : null
    if (!was || !ageClashes(years, was.age)) continue
    const now = counted ? `, so ${ageWords(counted.age)} by now` : ''
    out.push({ kind: 'age', entryId: p.id, text: `This card says ${p.name} is ${years}, but ${p.name}’s entry says ${was.basis.replace(/'/g, '’')}${now}.` })
  }
  return out
}

/** True when a finding names something Adam kept out of the scene's briefing. */
function hiddenIn(w: CardWorld, text: string): boolean {
  if (!w.hidden?.size) return false
  return w.entries.some((e) => w.hidden!.has(e.id) && namesOf(e).some((n) => namedInProse(text, n)))
}
