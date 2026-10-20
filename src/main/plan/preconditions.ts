// Can each planned beat happen? (2026-10-19, with place memory.) Once the plan comes back and is checked (plan.ts
// checkPlan), each beat's people and things are looked at against the story index, with no AI call:
// - a thing a beat has someone use (read, open, hand over, burn, wear…) that the index has elsewhere: left in another
//   place (storyIndex/placed.ts), or carried by someone who isn't in the scene;
// - someone a beat has act who isn't in the scene (not on the card, not on the stage, not named there by the words so
//   far) and whom the index last had in another place.
// When the thing is near (in another room of the same house) and the one who needs it is here, or someone here has it,
// a short note goes after that beat in the writer's plan ("First Mara Venn must fetch the letter from the vestry, where it
// was left under the loose hearthstone (Ch 2, Sc 3)."). Otherwise the beat is left as planned and noted for Adam on the
// plan's record (What the AI saw). Conservative: only when the index is sure (the thing's latest word in the index is
// where it was left or who has it; the person's last place is a scene card's), and never when the card, Adam's
// direction, the words so far or an earlier beat brings the thing or the person, or says where it is fetched from.
// Reads the database; no Electron imports.

import type Database from 'better-sqlite3'
import type { EntryState, ID, SceneCard } from '@shared/types'
import { thingsOf, type SceneState } from '@shared/continuity'
import { itemKey, singular } from '@shared/stageItems'
import { findName, namedInProse, soleFirstName } from '@shared/names'
import * as sidx from '../db/storyIndex'
import { namedThere } from '../ai/mustStay'
import { clip } from '../ai/lookups/text'
import { stateOf } from '../storyIndex/lookup'
import { carriedAt, heldNames, leftWords, sameThing, samePlaceOrNested, thingsLeft, type LeftThing } from '../storyIndex/placed'
import type { ScenePlan } from './plan'

type DB = Database.Database

/** What the check found: notes for the writer's plan (by beat, from 0), and what Adam should look at. */
export interface CanHappen {
  notes: { beat: number; note: string }[]
  flags: string[]
}

/** Everything a beat is checked against. */
export interface BeatWorld {
  db: DB
  storyId: ID
  sceneId: ID
  /** As the scene begins (a whole scene), or as its words so far end (carrying on). */
  asItBegins: boolean
  card: Pick<SceneCard, 'povId' | 'presentIds' | 'locationId'>
  /** Everyone in the scene (plan/core.ts present: the card, and whoever the stage and the words put there). */
  present: readonly ID[]
  entries: readonly Pick<EntryState, 'id' | 'name' | 'aliases' | 'kind'>[]
  /** Where things stand as told here (only the people in the scene). */
  stand?: SceneState | null
  /** What the scene card and Adam's direction say (plan.ts PlanMaterial.calls). */
  calls: string
  /** The scene's words so far, when carrying on. */
  soFar?: string
  /** What Adam kept out of the scene's briefing: never named. */
  hidden?: ReadonlySet<ID>
}

/** The most notes and flags one plan gets. */
export const CAN_HAPPEN_MOST = { notes: 4, flags: 6 }

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

// ---------- What a beat has someone use ----------

/** Verbs of using a thing one must have to hand (never of getting it: take, find, fetch). */
const USE_WORDS = `reads?|reading|rereads?|opens?|opened|opening|unfolds?|unfolded|unseals?|unsealed|unwraps?|unwrapped|shows?|showed|showing|
hands?|handed|handing|gives?|gave|giving|passes|passed|offers?|offered|burns?|burned|burnt|tears?|tore|rips?|ripped|waves?|waved|
clutches|clutched|hides?|hid|hiding|pockets?|pocketed|uses?|used|using|wields?|wielded|brandishes|brandished|unlocks?|unlocked|
wears?|wore|signs?|signed|studies|studied|examines?|examined|inspects?|inspected|produces?|produced|slides?|slid|throws?|threw|
drops?|dropped|tosses|tossed|pours?|poured|lays?|laid|sets?|puts?|places?|placed|returns?|returned|seals?|sealed|presses|pressed`.replace(/\s+/g, '')
const USE = new RegExp(`\\b(?:${USE_WORDS})\\b`, 'gi')
/** A verb of using a thing one must have to hand (the card check, cardCheck.ts, reads the card's beats with it). */
export const USE_WORD = new RegExp(`\\b(?:${USE_WORDS})\\b`, 'i')
/** Words of getting a thing, or going for it: a beat with one of these and the thing brings it. */
export const FETCH =
  /\b(?:fetch\w*|retriev\w*|recover\w*|collect\w*|gets?|got|getting|finds?|found|finding|digs?|dug|takes?|took|taking|picks? up|picked up|lifts?|lifted|pulls? out|pulled out|search\w*|looks? for|looked for|bring\w*|brought|steal\w*|stole|snatch\w*|grab\w*|seiz\w*|receiv\w*|is given|was given|goes (?:back )?(?:to|for)|went (?:back )?(?:to|for)|returns (?:to|for)|returned (?:to|for)|sends? for|sent for)\b/i

const PARTICLE = new Set('out up back down away aside over on off open round around aloud again'.split(' '))
const PRONOUN = new Set('him her them me us you it himself herself themselves itself everyone someone'.split(' '))
const DETERMINER = new Set('the a an his her their its my your our this that these those one some each every'.split(' '))
const STOP = new Set(
  `to from with at in on into onto under over for and but while as before after then so that which who of by aloud again until till
  or nor because if when where though although beside behind across through toward towards against near inside outside up down
  out back away off is was are were`.split(/\s+/)
)
/** What a beat's verb may have as its object that is never a thing left or carried. */
const NOT_THINGS = new Set(
  `it them one something nothing anything everything way time hand head eye face arm voice breath door word look glance nod smile
  hope truth news story question answer chance attention hold place lie order name back shoulder thank promise kiss`.split(/\s+/)
)

/** Things there are many of, one much like another: a beat's "the cup" may well be another cup than the one left. */
const COMMON = new Set(
  `cup mug glass tankard plate bowl bottle jug pitcher spoon fork bread wine ale beer water tea coffee food meal coin pipe
  cloth rag towel blanket pillow log stick stone rope`.split(/\s+/)
)
/** Words saying it is one thing among others like it ("a letter", "some bread"): never the one the story has. */
const INDEFINITE = new Set('a an some one another any'.split(' '))

interface Use {
  /** Where the verb is in the beat. */
  at: number
  /** The thing as compared ("letter", "forged letter"). */
  thing: string
  /** The thing as a note names it ("the forged letter"). */
  called: string
}

/**
 * The thing right after a verb of using ("reads the letter aloud" → "letter"; "hands Tobin the key" → "key"), when the
 * beat means one in particular ("the", "her"; never "a letter"), and it isn't one of many alike (COMMON). Null otherwise.
 */
function objectAfter(text: string, from: number, people: ReadonlySet<string>): Omit<Use, 'at'> | null {
  const tokens = text.slice(from).match(/[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}'’-]/gu) ?? []
  const got: string[] = []
  let owned = false
  for (const tok of tokens) {
    if (!/[\p{L}\p{N}]/u.test(tok)) break
    const w = tok.toLowerCase().replace(/['’]s$/, '')
    if (!got.length && INDEFINITE.has(w)) return null
    if (!got.length && (PARTICLE.has(w) || PRONOUN.has(w) || DETERMINER.has(w) || people.has(w))) {
      if (people.has(w) && /['’]s$/.test(tok)) owned = true
      continue
    }
    if (STOP.has(w) || people.has(w) || (w.length > 4 && w.endsWith('ly'))) break
    if (/['’]s$/.test(tok)) owned = true
    got.push(w)
    if (got.length >= 3) break
  }
  const thing = itemKey(got.join(' '))
  const head = singular(thing.split(' ').at(-1) ?? '')
  if (head.length < 3 || NOT_THINGS.has(head) || COMMON.has(head)) return null
  return { thing, called: `the ${owned ? (thing.split(' ').at(-1) ?? thing) : thing}` }
}

/** The things a beat has someone use, in order. */
function usesIn(beat: string, people: ReadonlySet<string>): Use[] {
  const out: Use[] = []
  for (const m of beat.matchAll(USE)) {
    const at = m.index ?? 0
    const o = objectAfter(beat, at + m[0].length, people)
    if (o && !out.some((u) => u.thing === o.thing)) out.push({ at, ...o })
  }
  return out
}

/** True when a text names the thing (its last word, as compared). */
function namesThing(text: string, thing: string): boolean {
  const head = singular(thing.split(' ').at(-1) ?? '')
  return !!head && wordsOf(text).some((w) => singular(w) === head)
}

// ---------- Who ----------

interface Person {
  id: ID
  name: string
  names: string[]
}

/** The people of the world (not those kept out), each with every name they go by: name, other names, a first name no one else has. */
function peopleOf(w: BeatWorld): Person[] {
  const chars = w.entries.filter((e) => e.kind === 'character' && !w.hidden?.has(e.id))
  const all = w.entries.flatMap((e) => [e.name, ...(e.aliases ?? [])].map((n) => ({ id: e.id, n: clean(n) })))
  return chars.map((e) => {
    const own = [e.name, ...(e.aliases ?? [])].map(clean).filter((n) => n.length >= 2)
    const first = soleFirstName(
      e.name,
      all.filter((x) => x.id !== e.id).map((x) => x.n)
    )
    return { id: e.id, name: clean(e.name), names: first && !own.includes(first) ? [...own, first] : own }
  })
}

/** Every place a name is in a text. */
function placesOf(text: string, name: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let from = 0
  for (;;) {
    const f = findName(text.slice(from), name)
    if (!f) return out
    out.push({ start: from + f.start, end: from + f.end })
    from += f.end
  }
}

/** Who a beat has use a thing: the person named last before the verb, else the point of view. */
function actorOf(beat: string, at: number, people: readonly Person[], pov: Person | null): Person | null {
  let best: Person | null = null
  let bestAt = -1
  for (const p of people)
    for (const n of p.names)
      for (const f of placesOf(beat.slice(0, at), n))
        if (f.start > bestAt) {
          best = p
          bestAt = f.start
        }
  return best ?? pov
}

/** Before a name: where a clause starts, so the name is who acts ("Tobin hands…", "…, and Tobin swears"). */
const CLAUSE_START = /(?:^|[.;:!?]\s*|,\s*|\b(?:and|then|while|as|when|before|after|until|but|so|once|now)\s+)$/i
/** After a name: what says it is not who acts ("Tobin's", "Tobin of the mill"). */
const NOT_ACTING = /^(?:['’]s\b|\s+(?:of|from|about|to|with|at|in|on|for|by|is not|isn't|is away|is gone|was not|wasn't)\b)/i

/** True when a beat has the person act: named where a clause starts, not as an owner, and not only thought of or far away. */
function actsIn(beat: string, p: Person): boolean {
  return p.names.some(
    (n) =>
      namedThere(beat, n) &&
      placesOf(beat, n).some((f) => CLAUSE_START.test(beat.slice(0, f.start)) && !NOT_ACTING.test(beat.slice(f.end)) && /^\s+\p{L}/u.test(beat.slice(f.end)))
  )
}

/** Words of someone coming into the scene. */
const ARRIVES = /\b(?:arriv\w*|enter\w*|appear\w*|turn\w* up|burst\w* in|comes? in|came in|steps? in|walks? in|shows? up|is let in|returns?|returned)\b/i

// ---------- The check ----------

/**
 * Checks each beat of a plan against the story index (see the top of this file). Nothing when the scene isn't in the
 * index. Never throws on what it can't read: what it isn't sure of, it leaves.
 */
export function beatsCanHappen(w: BeatWorld, plan: Pick<ScenePlan, 'beats' | 'changes'>): CanHappen {
  const out: CanHappen = { notes: [], flags: [] }
  const scene = sidx.indexScene(w.db, w.sceneId)
  const beats = plan.beats.map(clean).filter(Boolean)
  if (!scene || scene.storyId !== w.storyId || !beats.length) return out
  const cut = w.asItBegins ? scene.position - 1 : scene.position
  const placeId = w.card.locationId || null
  const parents = sidx.placeParents(w.db)
  const placeNames = sidx.entryNames(w.db, placeId ? [placeId] : [])
  const here = new Set(w.present)
  const people = peopleOf(w)
  const byId = new Map(people.map((p) => [p.id, p]))
  const pov = w.card.povId && here.has(w.card.povId) ? (byId.get(w.card.povId) ?? null) : null
  const nameWords = new Set(people.flatMap((p) => p.names.flatMap((n) => wordsOf(n))))
  const positions = new Map(sidx.indexScenes(w.db, w.storyId).map((s) => [s.sceneId, s.position]))
  const calls = clean(w.calls)
  const soFar = clean(w.soFar)
  const changes = plan.changes.join('\n')

  // What the index has: things left anywhere, and what everyone carries, at this point.
  const left = thingsLeft(w.db, w.storyId, w.sceneId, { asItBegins: w.asItBegins }).filter((t) => !w.hidden?.has(t.placeId))
  const carried = carriedAt(w.db, w.storyId, cut).map((c) => ({ ...c, things: heldNames(c.value) }))
  const stage = w.stand ?? null
  const onStage = (thing: string): boolean =>
    thingsOf(stage).some((t) => sameThing(t.name, thing)) || (stage?.characters ?? []).some((c) => heldNames(c.holding).some((k) => sameThing(k, thing)))
  const near = (a: ID, b: ID): boolean => {
    const pa = parents.get(a) ?? null
    return !!pa && pa === (parents.get(b) ?? null)
  }

  const seen = new Set<string>()
  for (const [i, beat] of beats.entries()) {
    const sofar = beats.slice(0, i + 1).join('\n')
    // ---- Things ----
    for (const use of usesIn(beat, nameWords)) {
      const key = `${i}|${use.thing}`
      if (seen.has(key)) continue
      seen.add(key)
      const thing = use.thing
      // Here already, or brought: on the stage, in the words so far, fetched in this beat or one before, by a change, or
      // the card or the direction say how it comes.
      if (onStage(thing) || (soFar && namesThing(soFar, thing))) continue
      if (beats.slice(0, i + 1).some((b) => FETCH.test(b) && namesThing(b, thing))) continue
      if (/\bholding\b/i.test(changes) && namesThing(changes, thing)) continue
      if (calls && FETCH.test(calls) && namesThing(calls, thing)) continue
      const actor = actorOf(beat, use.at, people, pov)
      // Someone here has it: they hand it over first, unless the beat has them do so.
      const holder = carried.find((c) => here.has(c.entryId) && c.things.some((k) => sameThing(k, thing)))
      if (holder) {
        const h = byId.get(holder.entryId)
        if (h && actor && here.has(actor.id) && h.id !== actor.id && !h.names.some((n) => namedInProse(beat, n)) && out.notes.length < CAN_HAPPEN_MOST.notes)
          out.notes.push({ beat: i, note: `First ${h.name} must hand ${use.called} to ${actor.name} (${h.name} has had it since ${holder.since}).` })
        continue
      }
      if (placeId && left.some((t) => sameThing(t.name, thing) && samePlaceOrNested(t.placeId, placeId, parents))) continue
      // Elsewhere: the index's latest word on it, where it was left or who has it.
      const there: { at: number; left?: LeftThing; by?: (typeof carried)[number] }[] = [
        ...left.filter((t) => sameThing(t.name, thing)).map((t) => ({ at: positions.get(t.sinceSceneId) ?? 0, left: t })),
        ...carried.filter((c) => c.things.some((k) => sameThing(k, thing))).map((c) => ({ at: c.position, by: c }))
      ].sort((a, b) => a.at - b.at)
      const latest = there.at(-1)
      if (!latest) continue
      const said = `Beat ${i + 1} (“${clip(beat, 100)}”)`
      if (latest.left) {
        const t = latest.left
        if (!placeId) continue
        // The card, the direction or a beat so far takes the scene where it is.
        if ([calls, sofar].some((x) => namedInProse(x, t.place))) continue
        if (actor && here.has(actor.id) && near(t.placeId, placeId)) {
          if (out.notes.length < CAN_HAPPEN_MOST.notes)
            out.notes.push({ beat: i, note: `First ${actor.name} must fetch ${t.name} from ${t.place}, where it was left ${leftWords(t.how)} (${t.since}).` })
        } else if (out.flags.length < CAN_HAPPEN_MOST.flags) {
          const at = placeNames.get(placeId)?.name
          out.flags.push(
            `${said} needs ${t.name}, but the story last left it ${leftWords(t.how)} at ${t.place} (${t.since}) and nothing since has anyone take it${at ? `; this scene is at ${at}` : ''}.`
          )
        }
        continue
      }
      const by = latest.by!
      const h = byId.get(by.entryId)
      if (!h || here.has(h.id) || (actor && actor.id === h.id) || h.names.some((n) => namedInProse(calls, n))) continue
      if (out.flags.length < CAN_HAPPEN_MOST.flags)
        out.flags.push(`${said} needs ${use.called}, but ${h.name} has it (carrying ${by.value}, since ${by.since}), and ${h.name} isn’t in this scene.`)
    }
    // ---- People ----
    for (const p of people) {
      if (here.has(p.id) || seen.has(`${i}|@${p.id}`) || !actsIn(beat, p)) continue
      seen.add(`${i}|@${p.id}`)
      // The card or the direction bring them, the words so far have them, or a beat so far has them come in.
      if (p.names.some((n) => namedInProse(calls, n) || (soFar && namedInProse(soFar, n)))) continue
      if (beats.slice(0, i + 1).some((b) => ARRIVES.test(b) && p.names.some((n) => namedInProse(b, n)))) continue
      if (!placeId) continue
      const seenAt = sidx.lastPresentBefore(w.db, w.storyId, p.id, cut + 1)
      if (!seenAt?.placeEntryId || samePlaceOrNested(seenAt.placeEntryId, placeId, parents) || w.hidden?.has(seenAt.placeEntryId)) continue
      if (stateOf(w.db, w.storyId, p.id, w.sceneId, { asItBegins: w.asItBegins })?.dead) continue
      const where = sidx.entryNames(w.db, [seenAt.placeEntryId]).get(seenAt.placeEntryId)?.name
      if (!where || out.flags.length >= CAN_HAPPEN_MOST.flags) continue
      out.flags.push(
        `Beat ${i + 1} (“${clip(beat, 100)}”) has ${p.name} there, but ${p.name} isn’t in this scene: its card doesn’t bring them, and the story last had them at ${where} (${seenAt.label}).`
      )
    }
  }
  return out
}
