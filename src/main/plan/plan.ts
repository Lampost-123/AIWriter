// Plan before writing (step 4 of the consistency plan, Adam 2026-10-07). Before the prose is written, one short call to
// the memory model plans the scene (or, for Beat by beat, the one beat): which facts and positions it relies on, what
// will change on the page (a coat taken off, a move to the window), and any codex entry it needs that isn't in the
// briefing. The app then fetches what is missing and checks the plan:
// - against the stage, as far as it still holds here (stageReach, as for what must stay true: all of it carrying on
//   inside a scene; at a new scene's start the same day, injuries, clothes and what people hold; on a later day or
//   after a gap not known, injuries only; nothing from another story): a position the plan relies on is told in the
//   stage's own words, and one the stage doesn't vouch for here only when the scene card says it;
// - a fact only when its words are in what the planner was given (never one kept from someone in the scene);
// - a change is left out when it is already so, starts from something the stage says isn't so, is made by someone
//   dead, has someone learn what is kept from them (unless the scene card says so), or is an event the scene card,
//   the beat or the author's direction doesn't call for (moving, dressing, picking things up need no asking).
// What is left goes in as the opening of the writer's own notes, after the closing instruction, so the prose carries on
// from it rather than from a distant rule: with cheap models (DeepSeek), events given as a rule were ignored 9 times in
// 9, and followed 3 times in 3 as text the model carried on from. Never holds a draft up: a plan that fails, is stopped
// or takes too long is no plan. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextPreview, EntryState, ID } from '@shared/types'
import { clothesOf, quoteFound, thingsOf, type CharacterState, type SceneState, type StateField } from '@shared/continuity'
import { isOff, itemKey, namesItem, parsePiece, pieceText, thingText, type StageItem } from '@shared/stageItems'
import * as gens from '../db/generations'
import { callModel, type MemoryModel } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { MUST_BLOCK, sceneTail, stageReach, type ContextInput, type PreparedContext } from '../ai/context'
import { deathOf } from '../ai/deaths'
import { pieceLine, secretsAmong, stageFor, stageLine, type Secret, type StageReach } from '../ai/mustStay'
import { SPEAKER_TAG_LINE } from '../ai/speakerTags'
import { SO_FAR_BLOCK } from '../beats/instructions'
import { PLAN_GO, PLAN_HEAD, PLAN_PARTS } from './echo'

export { PLAN_GO, PLAN_HEAD, PLAN_PARTS } from './echo'

type DB = Database.Database

export const PLAN_MARKER = '[AIWRITE-PLAN v1]'
/** How long a draft waits for its plan before going ahead without one. */
export const PLAN_LIMIT_MS = 30_000
/** Room for the planner's reply. */
export const PLAN_REPLY_TOKENS = 900
/** The most of each the plan keeps. */
export const PLAN_MOST = { relies: 10, changes: 8, needs: 4 }
/** Only a scene's newest few planning calls keep their whole prompt (each holds much of the briefing). */
export const KEEP_PLAN_PROMPTS = 10
/** The most entries named for the planner: those in the briefing, and those it may ask for. */
const MOST_NAMED = { inBriefing: 40, others: 150 }
/** About how much of the words just before the planner reads. */
const BEFORE_WORDS = { min: 200, target: 300, max: 400 }

// ---------- What the planner is given ----------

export interface PlanMaterial {
  /** What the writer is asked: the closing instruction. */
  ask: string
  card: string
  /** For Beat by beat: the one beat to plan ("beat 2 of 5: …", with Adam's note for it); '' plans the scene. */
  focus: string
  /** What must stay true (ai/mustStay.ts), as the writer gets it; '' for none. */
  must: string
  /** How far where things stand still holds here (stageReach). */
  reach: StageReach
  /** Where things stand, as the writer gets it, under its own title, with what of it may have changed; '' for none. */
  stand: string
  standTitle: string
  standNote: string
  /** The end of the scene so far, or of the previous scene. */
  before: { title: string; text: string } | null
  /** Each entry in the briefing, one line. */
  inBriefing: string[]
  /** The names of entries that exist here but aren't in the briefing, which the plan may ask for. */
  others: string[]
  /** The people on the scene card, and what some of them know and others don't. */
  people: string[]
  secrets: Secret[]
  /** What an event the plan has happen must answer to: the scene card (with the author's direction), or the beat. */
  calls: string
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** What may have changed of where things stand, by how far it still holds here. */
const STAND_NOTE: Record<StageReach, string> = {
  here: '',
  start:
    'This was as the scene before ended, earlier the same day. The scene card says where and when this scene is: people may have moved. Injuries, what people wear and what they hold carry on unless the card says otherwise, and so do the things in the place, given only when this scene is in the same place.',
  later:
    'This was as the scene before ended, and time has passed since (a later day, or how long is not known). Only injuries surely carry on: where people are, how they are placed and what they wear and hold may all have changed.',
  none: ''
}

/**
 * What the planner reads, from the writer's briefing as it stands (before the plan). `focus`: for Beat by beat, the
 * one beat to plan.
 */
export function planMaterial(input: ContextInput, preview: ContextPreview, prepared: Pick<PreparedContext, 'finals'>, focus = ''): PlanMaterial {
  const sent = preview.blocks.filter((b) => !b.dropped)
  const block = (id: string) => sent.find((b) => b.id === id)
  const text = (id: string): string => block(id)?.text.trim() ?? ''
  const soFar = text(SO_FAR_BLOCK)
  const previous = text('previous-scene')
  const before = soFar
    ? { title: 'The end of the scene so far', text: sceneTail(soFar, BEFORE_WORDS) }
    : previous
      ? { title: 'The end of the previous scene', text: sceneTail(previous, BEFORE_WORDS) }
      : null
  const ask = (previous ? prepared.finals.withPrevious : prepared.finals.withoutPrevious).replace(SPEAKER_TAG_LINE, '').trim()
  const byId = new Map<ID, EntryState>([...input.memory.elsewhere.map((x) => [x.entry.id, x.entry] as const), ...input.memory.entries.map((e) => [e.id, e] as const)])
  const shown = new Set((preview.entries ?? []).filter((e) => !e.hidden && e.blockId).map((e) => e.entryId))
  const hidden = new Set((preview.entries ?? []).filter((e) => e.hidden).map((e) => e.entryId))
  const inBriefing = [...shown]
    .map((id) => byId.get(id))
    .filter((e): e is EntryState => !!e)
    .slice(0, MOST_NAMED.inBriefing)
    .map((e) => `${e.name} (${e.kind})${clean(e.summary) ? `: ${clean(e.summary)}` : ''}`)
  const others = input.memory.entries
    .filter((e) => !shown.has(e.id) && !hidden.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MOST_NAMED.others)
    .map((e) => {
      const aka = (e.aliases ?? []).map(clean).filter(Boolean)
      return `${e.name} (${e.kind}${aka.length ? `; also ${aka.join(', ')}` : ''})`
    })
  const card = input.scene.card
  const people = [...new Set([card.povId, ...card.presentIds])]
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((e): e is EntryState => !!e && e.kind === 'character')
  const reach = stageReach(input)
  const stand = reach === 'none' ? null : block('continuity')
  return {
    ask,
    card: text('scene-card'),
    focus: clean(focus),
    must: text(MUST_BLOCK),
    reach,
    stand: stand?.text.trim() ?? '',
    standTitle: stand?.title ?? 'Where things stand',
    standNote: stand ? STAND_NOTE[reach] : '',
    before,
    inBriefing,
    others,
    people: people.map((e) => e.name),
    secrets: secretsAmong(people, input.memory.facts),
    calls: focus ? [focus, input.options.direction].filter((s) => clean(s)).join('\n') : text('scene-card')
  }
}

const SYSTEM = `${PLAN_MARKER} plan
You plan one scene of a novel (or one beat of it) just before it is written, so the writer keeps to the facts. You don't write any of the scene.

Read what the writer is asked, the scene card, what must stay true, where things stand and the words just before. Then say:
- relies: the facts and positions the scene relies on: where people are, each piece of clothing they wear or took off, what they hold, how they are placed, injuries, and the things in the place (a door barred, a case on the windowsill). Copy each value word for word from what you are given. Never guess one.
- changes: what will change on the page, in the order it happens: only what the scene card, its beats or the author's direction call for (when you are asked to plan one beat, only that beat), and the moves they need (a coat taken off, a move to the window, something picked up or put down). For each: how it is now (from), how it is after (to), and how it happens, in one short sentence (how). Add no events of your own.
- needs: the names of entries under "Also in the world" that the scene needs and the briefing lacks (a place it moves to, an object or a person it brings in). Exactly as listed, at most 4. None is fine.

Reply with only a JSON object:
{"relies": [{"who": "", "what": "", "value": ""}], "changes": [{"who": "", "what": "", "from": "", "to": "", "how": ""}], "needs": [""]}
- who: a character's name as given, or "" for the scene itself or a fact about the world.
- what: one of where, wearing, position, touching, sees, holding, condition, mood, time, light, weather, thing, or fact.
- A piece of clothing: what is "wearing", and the value, from and to name the piece and how it is ("boots off, by the door"). A thing in the place: what is "thing", who is whoever changes it (or ""), and the value, from and to name the thing and how it is ("the door: barred from inside").
- Keep to what must stay true and to where things stand: nothing changes unless it happens on the page, and each change starts from how things are now.
- What is kept from someone stays kept: never have them learn, guess or be told it, unless the scene card says so.
- At most ${PLAN_MOST.relies} relies and ${PLAN_MOST.changes} changes, the ones that matter most. Keep each short.`

/** What the memory model is asked. */
export function planMessages(m: PlanMaterial): ChatMessage[] {
  const part = (title: string, body: string): string => (body.trim() ? `## ${title}\n${body.trim()}` : '')
  const user = [
    part('What the writer is asked', m.ask),
    part('The scene card', m.card),
    part('Plan only this beat', m.focus ? `${m.focus}\nThe beats after it are written later: plan nothing from them.` : ''),
    part('Must stay true', m.must),
    part(m.standTitle, m.stand ? [m.standNote, m.stand].filter(Boolean).join('\n') : ''),
    m.before ? part(m.before.title, `"""\n${m.before.text}\n"""`) : '',
    part('In the briefing', m.inBriefing.map((l) => `- ${l}`).join('\n')),
    part('Also in the world (not in the briefing)', m.others.join('; ')),
    `Plan the ${m.focus ? 'beat' : 'scene'} now, as one JSON object.`
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ]
}

// ---------- Reading the reply ----------

export interface RawPlan {
  relies: { who: string; what: string; value: string }[]
  changes: { who: string; what: string; from: string; to: string; how: string }[]
  needs: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? clean(v).slice(0, 400) : '')
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/** The planner's reply, read; null when it isn't JSON. Anything missing is empty. */
export function readPlan(reply: string): RawPlan | null {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  let v: unknown
  try {
    v = JSON.parse(body)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  return {
    relies: list(o.relies).map((r) => ({ who: str(r.who), what: str(r.what), value: str(r.value) })),
    changes: list(o.changes).map((c) => ({ who: str(c.who), what: str(c.what), from: str(c.from), to: str(c.to), how: str(c.how) })),
    needs: (Array.isArray(o.needs) ? o.needs : [])
      .map((n) => (typeof n === 'string' ? str(n) : n && typeof n === 'object' ? str((n as Record<string, unknown>).name) : ''))
      .filter(Boolean)
  }
}

// ---------- Checking it against the stage ----------

type SceneField = 'time' | 'light' | 'weather'
type Field = StateField | SceneField | 'wearing' | 'thing'

/** The stage's field for what the planner wrote ("position" is posture); null for a fact. */
export function fieldOf(what: string): Field | null {
  const w = what.toLowerCase().replace(/[^a-z]/g, '')
  if (['where', 'place', 'location', 'whereabouts'].includes(w)) return 'where'
  if (['wearing', 'clothes', 'clothing', 'dress', 'outfit'].includes(w)) return 'wearing'
  if (['position', 'posture', 'pose', 'placed'].includes(w)) return 'posture'
  if (['touching', 'touch', 'touches', 'contact'].includes(w)) return 'touching'
  if (['sees', 'seeing', 'sight', 'hears', 'hearing', 'seesorhears', 'senses'].includes(w)) return 'sees'
  if (['thing', 'things', 'object', 'objects', 'item', 'items', 'door', 'prop'].includes(w)) return 'thing'
  if (['holding', 'carrying', 'held', 'holds'].includes(w)) return 'holding'
  if (['condition', 'injury', 'injuries', 'health', 'body'].includes(w)) return 'condition'
  if (['mood', 'feeling', 'feelings'].includes(w)) return 'mood'
  if (['lastaction', 'action'].includes(w)) return 'lastAction'
  if (w === 'time' || w === 'light' || w === 'weather') return w
  return null
}

const SCENE_FIELDS: readonly string[] = ['time', 'light', 'weather']
/**
 * The stage's fields that still hold here, by how far the stage reaches (as what must stay true keeps them). The things
 * in the place reach a new scene's start only when it is the same place: the stage has none otherwise.
 */
const IN_REACH: Record<StageReach, readonly Field[]> = {
  here: [
    'where',
    'wearing',
    'posture',
    'touching',
    'sees',
    'holding',
    'condition',
    'mood',
    'lastAction',
    'time',
    'light',
    'weather',
    'thing'
  ],
  start: ['condition', 'wearing', 'holding', 'thing'],
  later: ['condition'],
  none: []
}
/**
 * Changes that need no asking: people moving, dressing, touching, picking things up and putting them down, opening a
 * door, and how they feel. Who sees whom is not among them: someone being seen can be what happens.
 */
const FREE_MOVES: readonly Field[] = ['where', 'wearing', 'posture', 'touching', 'holding', 'mood', 'lastAction', 'thing']

/** Words that say how something is, in pairs that can't both hold. */
const OPPOSITES: [string, string][] = [
  ['on', 'off'],
  ['open', 'closed'],
  ['open', 'shut'],
  ['up', 'down'],
  ['in', 'out'],
  ['standing', 'sitting'],
  ['standing', 'lying'],
  ['sitting', 'lying'],
  ['standing', 'kneeling'],
  ['asleep', 'awake'],
  ['locked', 'unlocked'],
  ['locked', 'open'],
  ['barred', 'open'],
  ['barred', 'unbarred'],
  ['bolted', 'open'],
  ['bolted', 'unbolted'],
  ['lit', 'unlit'],
  ['lit', 'out'],
  ['dry', 'wet'],
  ['dry', 'soaked'],
  ['buttoned', 'unbuttoned'],
  ['laced', 'unlaced'],
  ['tied', 'untied']
]
const STATE_WORDS = new Set(OPPOSITES.flat())
const opposite = (a: string, b: string): boolean => OPPOSITES.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
const SMALL = new Set(['the', 'and', 'her', 'his', 'their', 'its', 'a', 'an', 'of', 'with', 'by', 'at', 'to', 'from', 'over', 'under', 'she', 'he', 'they'])
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** The word saying how a thing is, nearest to it (within three words; after it on a tie), or null. */
function stateNear(words: string[], at: number): string | null {
  let best: { word: string; d: number; after: boolean } | null = null
  for (let j = Math.max(0, at - 3); j <= Math.min(words.length - 1, at + 3); j++) {
    if (j === at || !STATE_WORDS.has(words[j])) continue
    const d = Math.abs(j - at)
    if (!best || d < best.d || (d === best.d && j > at && !best.after)) best = { word: words[j], d, after: j > at }
  }
  return best?.word ?? null
}

/**
 * True when two descriptions disagree about something both name: "boots on" and "shirt open, boots off by the door"
 * (the boots), "sitting by the fire" and "standing by the fire". Only the word saying how each thing is counts, so
 * different wording that agrees ("cloak on, boots off" and "boots off, cloak on") doesn't.
 */
export function contradicts(a: string, b: string): boolean {
  const x = tokens(a)
  const y = tokens(b)
  for (let i = 0; i < x.length; i++) {
    const w = x[i]
    if (w.length < 3 || SMALL.has(w) || STATE_WORDS.has(w)) continue
    const s = stateNear(x, i)
    if (!s) continue
    for (let j = 0; j < y.length; j++) {
      if (y[j] !== w) continue
      const t = stateNear(y, j)
      if (t && opposite(s, t)) return true
    }
  }
  // How a person is placed: "standing" against "sitting on the bed", with nothing named in both.
  const pose = (ws: string[]): string | null => ws.find((v) => ['standing', 'sitting', 'lying', 'kneeling'].includes(v)) ?? null
  const p = pose(x)
  const q = pose(y)
  return !!p && !!q && opposite(p, q)
}

const plainText = (s: string): string => tokens(s).join(' ')

/** Words that say little about what happens. */
const FILLER = new Set([
  'the', 'and', 'her', 'his', 'him', 'she', 'they', 'them', 'their', 'its', 'was', 'were', 'are', 'has', 'had', 'have', 'been', 'for',
  'but', 'not', 'who', 'how', 'did', 'does', 'one', 'out', 'off', 'can', 'may', 'that', 'this', 'with', 'from', 'into', 'onto',
  'then', 'than', 'there', 'what', 'when', 'where', 'which', 'while', 'about', 'over', 'under', 'after', 'before', 'still', 'just',
  'only', 'some', 'more', 'most', 'very', 'back', 'down', 'again', 'once', 'each', 'other', 'will', 'would', 'says', 'said', 'tells',
  'told', 'scene', 'beat', 'now', 'all', 'any', 'too', 'yet', 'own'
])
const stem = (w: string): string => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w)
/** The words of a text that say what happens: no filler, no names of the people in the scene, endings taken off. */
const meaningWords = (s: string, names: ReadonlySet<string>): Set<string> =>
  new Set(tokens(s).filter((w) => w.length >= 3 && !FILLER.has(w) && !names.has(w)).map(stem))
const sharedWords = (a: Set<string>, b: Set<string>): number => [...a].filter((w) => b.has(w)).length

/** True when `text` says the secret `fact`: enough of the fact's own words (two, or a third of them) are in it. */
function says(text: string, fact: string, names: ReadonlySet<string>): boolean {
  const f = meaningWords(fact, names)
  if (!f.size) return false
  return sharedWords(f, meaningWords(text, names)) >= Math.min(f.size, Math.max(2, Math.ceil(f.size / 3)))
}

/** True when what a change makes happen answers to `calls` (the card, or the beat): a third of its words are there. */
function calledFor(change: string, calls: string, names: ReadonlySet<string>): boolean {
  const c = meaningWords(change, names)
  if (!c.size) return false
  return sharedWords(c, meaningWords(calls, names)) >= Math.max(1, Math.ceil(c.size / 3))
}

export interface CheckWith {
  /** Where things stand at the point of writing; null when not known. */
  stand: SceneState | null | undefined
  /** How far it still holds here (stageReach). */
  reach: StageReach
  /** What the planner was given (without where things stand, unless it all holds here), for the facts it relies on. */
  material: string
  /** The scene card as the writer gets it: a position the stage doesn't vouch for here only when the card says it. */
  card: string
  /** What an event must answer to: the scene card, or the one beat. */
  calls: string
  /** The people on the scene card, and what some of them know and others don't. */
  people: string[]
  secrets: Secret[]
  /** Every entry that exists here, for what the plan asks for and who is dead. */
  entries: EntryState[]
  /** Entries already in the briefing, and those Adam kept out: never asked for. */
  inBriefing: ReadonlySet<ID>
  hidden: ReadonlySet<ID>
}

export interface ScenePlan {
  /** What the scene rests on, as things stand. */
  keep: string[]
  /** What happens on the page, in order. */
  changes: string[]
  /** The codex entries to bring into the briefing. */
  needs: ID[]
  /** How the check went: values put right from the stage, and things left out. */
  checked: { corrected: number; dropped: number }
}

/** The plan, checked against the stage and the codex (see the top of this file). */
export function checkPlan(raw: RawPlan, w: CheckWith): ScenePlan {
  const keep: string[] = []
  const changes: string[] = []
  const needs: ID[] = []
  let corrected = 0
  let dropped = 0
  const reaches = (f: Field): boolean => IN_REACH[w.reach].includes(f)
  const stage = (who: string): CharacterState | null => (who ? stageFor({ name: who, aliases: [] }, w.stand) : null)
  /**
   * The pieces someone wears, or the things in the place, that `about` names (for clothing with none named, all of them;
   * a thing has to be named), where the stage still holds here.
   */
  const itemsOf = (who: string, f: 'wearing' | 'thing', about: string): StageItem[] => {
    if (!reaches(f)) return []
    const all = f === 'thing' ? thingsOf(w.stand) : clothesOf(stage(who))
    const named = all.filter((x) => namesItem(about, x))
    return named.length || f === 'thing' ? named : all
  }
  /** What the stage says of a field here (of the pieces or things `about` names); '' when it doesn't say, or doesn't hold here. */
  const nowOf = (who: string, f: Field, about = ''): string => {
    if (f === 'wearing') return itemsOf(who, f, about).map(pieceText).join('; ')
    if (f === 'thing') return itemsOf(who, f, about).map(thingText).join('; ')
    return !reaches(f) ? '' : SCENE_FIELDS.includes(f) ? clean(w.stand?.[f as SceneField]) : clean(stage(who)?.[f as StateField])
  }
  /** True when a change's `to` is how it already is: the same words, or putting on a piece already on. */
  const alreadySo = (who: string, f: Field, to: string, now: string): boolean => {
    if (plainText(to) === plainText(now)) return true
    if (f !== 'wearing') return false
    const want = parsePiece(to)
    return itemsOf(who, f, to).some(
      (p) =>
        plainText(pieceText(p)) === plainText(to) || (!!want && !isOff(p.state) && !want.state && itemKey(want.name) === itemKey(p.name))
    )
  }
  const nameOf = (who: string): string => clean(stage(who)?.name) || who
  const put = (line: string): void => {
    if (line && !keep.some((l) => l.toLowerCase() === line.toLowerCase())) keep.push(line)
  }
  const names = new Set(w.people.flatMap((n) => tokens(n)))
  const onCard = (who: string): boolean => {
    const n = clean(who).toLowerCase()
    return !!n && w.people.some((p) => p.toLowerCase() === n || p.toLowerCase().startsWith(`${n} `))
  }
  /** Says something kept from someone in the scene that the scene card doesn't bring up. */
  const tellsSecret = (text: string): boolean => w.secrets.some((s) => says(text, s.fact, names) && !says(w.card, s.fact, names))

  for (const r of raw.relies.slice(0, PLAN_MOST.relies)) {
    if (!r.value) continue
    const f = fieldOf(r.what)
    // The scene's time and the like, and a thing in the place, belong to no one.
    const scene = !!f && (SCENE_FIELDS.includes(f) || f === 'thing')
    if (f && (scene || r.who)) {
      // A position or the like: the stage's own words, whatever the planner wrote, where the stage still holds.
      const now = nowOf(r.who, f, r.value)
      if (now) {
        if (plainText(now) !== plainText(r.value)) corrected++
        // What someone wears: each piece it names on its own line, or, naming none, the whole of it.
        const named = f === 'wearing' && reaches(f) ? clothesOf(stage(r.who)).filter((x) => namesItem(r.value, x)) : []
        if (named.length) for (const p of named) put(pieceLine(nameOf(r.who), p))
        else put(stageLine(scene ? '' : nameOf(r.who), f, now))
        continue
      }
      // Not on the stage here: only what the planner was given (a mark on the codex page, say); where the stage no
      // longer holds (a new scene), only what the scene card says, never the scene before's.
      const source = reaches(f) ? w.material : w.card
      if (quoteFound(r.value, source)) put(stageLine(r.who || '', f, r.value))
      else dropped++
      continue
    }
    // A fact: only one in what the planner was given, and never one kept from someone here.
    if (!quoteFound(r.value, w.material) || tellsSecret(r.value)) {
      dropped++
      continue
    }
    put(r.who && !r.value.toLowerCase().startsWith(r.who.toLowerCase()) ? `${r.who}: ${r.value}` : r.value)
  }

  const callWords = new Set(tokens(w.calls))
  const dead = w.entries.filter((e) => deathOf(e)).flatMap((e) => [e.name, ...(e.aliases ?? [])].map((n) => clean(n).toLowerCase()))
  const isDead = (who: string): boolean => {
    const n = clean(who).toLowerCase()
    return !!n && dead.some((d) => d === n || d.startsWith(`${n} `))
  }
  for (const c of raw.changes.slice(0, PLAN_MOST.changes)) {
    if (!c.how && !c.to) continue
    const f = fieldOf(c.what)
    const now = f && (SCENE_FIELDS.includes(f) || f === 'thing' || c.who) ? nowOf(c.who, f, [c.from, c.to, c.how].join(' ')) : ''
    const said = [c.how, c.to].filter(Boolean).join('. ')
    // Someone who could move or dress here (on the card, or on the stage carrying on inside the scene); anyone else only
    // when the card (or the beat) names them.
    const here = onCard(c.who) || (w.reach === 'here' && !!stage(c.who))
    const named = !c.who || here || tokens(c.who).every((t) => callWords.has(t))
    const leave =
      isDead(c.who) ||
      // Already so: nothing to change. Starting from something the stage says isn't so: planned from a wrong picture.
      (!!now && ((!!c.to && alreadySo(c.who, f!, c.to, now)) || (!!c.from && contradicts(c.from, now)))) ||
      // Someone learning what is kept from them, when the scene card doesn't say they do.
      tellsSecret(said) ||
      // An event (or an injury, or someone not in the scene) the card or the beat doesn't call for.
      (!(f && FREE_MOVES.includes(f) && here) && !(named && calledFor(said, w.calls, names)))
    if (leave) {
      dropped++
      continue
    }
    const line = c.how || `${c.who ? `${c.who}: ` : ''}${c.what ? `${c.what} ` : ''}now ${c.to}`
    if (!changes.some((l) => l.toLowerCase() === line.toLowerCase())) changes.push(line)
  }

  // What it asks for: an entry by its name or other name exactly (a note after it in brackets, or "the" before it,
  // aside), never one the briefing has or Adam kept out.
  const bare = (s: string): string =>
    clean(s)
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/^the\s+/i, '')
      .toLowerCase()
  const byName = new Map<string, EntryState>()
  for (const e of w.entries) {
    if (w.inBriefing.has(e.id) || w.hidden.has(e.id)) continue
    for (const n of [e.name, ...(e.aliases ?? [])]) if (bare(n) && !byName.has(bare(n))) byName.set(bare(n), e)
  }
  for (const n of raw.needs) {
    if (needs.length >= PLAN_MOST.needs) break
    const e = byName.get(bare(n))
    if (e && !needs.includes(e.id)) needs.push(e.id)
  }
  return { keep, changes, needs, checked: { corrected, dropped } }
}

/** The plan as the writer's own notes, leading into the prose; '' when it says nothing. */
export function planText(p: Pick<ScenePlan, 'keep' | 'changes'>, carryingOn: boolean): string {
  if (!p.keep.length && !p.changes.length) return ''
  const parts = [PLAN_HEAD]
  if (p.keep.length) parts.push(`${PLAN_PARTS.keep}\n${p.keep.map((l) => `- ${l}`).join('\n')}`)
  if (p.changes.length) parts.push(`${PLAN_PARTS.changes}\n${p.changes.map((l, i) => `${i + 1}. ${l}`).join('\n')}`)
  parts.push(carryingOn ? PLAN_GO.here : PLAN_GO.start)
  return parts.join('\n')
}

/**
 * True when the briefing with the plan (and what it asked for) loses nothing the briefing without it had room for:
 * every part sent before is still sent, none of it shorter, the reply's room is the same, and it still fits (or didn't
 * fit before either). Not enough room means no plan.
 */
export function keepsRoom(before: Pick<ContextPreview, 'blocks' | 'budget'>, after: Pick<ContextPreview, 'blocks' | 'budget'>): boolean {
  const now = new Map(after.blocks.map((x) => [x.id, x]))
  for (const x of before.blocks) {
    if (x.dropped) continue
    const y = now.get(x.id)
    if (!y || y.dropped || y.tokens < x.tokens) return false
  }
  if (after.budget.reserved < before.budget.reserved) return false
  return after.budget.used <= after.budget.available || before.budget.used > before.budget.available
}

// ---------- The call ----------

export interface PlanCall {
  db: DB
  model: MemoryModel
  sceneId: ID
  material: PlanMaterial
  check: Pick<CheckWith, 'stand' | 'entries' | 'inBriefing' | 'hidden'>
  /** The writing carries on from words already in the scene (Add below, a later beat). */
  carryingOn: boolean
  /** Adam stopped the draft before it began. */
  signal?: AbortSignal
  /** True once the world has closed. */
  closed: () => boolean
  limitMs?: number
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export interface MadePlan {
  needs: ID[]
  /** The writer's notes; '' when the plan only asked for entries. */
  text: string
  checked: ScenePlan['checked']
}

/**
 * Plans the scene with the memory model (as a 'memory' record, so "What the AI saw" shows what it was asked; only the
 * scene's newest KEEP_PLAN_PROMPTS keep their whole prompt), and checks the plan. Null when there is nothing to go on:
 * the call failed, was stopped, took longer than `limitMs` (it is then stopped too), or said nothing usable. Never
 * throws.
 */
export async function makePlan(o: PlanCall): Promise<MadePlan | null> {
  if (o.signal?.aborted || o.closed()) return null
  const stop = new AbortController()
  const onAbort = (): void => stop.abort()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  const limit = o.limitMs ?? PLAN_LIMIT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let late: ReturnType<typeof setTimeout> | undefined
  try {
    timer = setTimeout(() => stop.abort(), limit)
    const m = o.material
    const messages = planMessages(m)
    const user = messages[1].content
    const call = callModel({
      db: o.db,
      model: o.model,
      targetId: o.sceneId,
      job: 'memory',
      messages,
      blocks: [{ id: 'plan', title: 'Planning the scene', text: user, tokens: estimateTokens(user), priority: 1, dropped: false, short: false, entryIds: [] }],
      maxTokens: PLAN_REPLY_TOKENS,
      signal: stop.signal,
      closed: o.closed,
      fetchImpl: o.fetchImpl,
      retryDelays: o.retryDelays
    })
    // Stopping the call ends it at once; this is only in case something doesn't hear the stop.
    const gaveUp = new Promise<null>((resolve) => {
      late = setTimeout(() => resolve(null), limit + 2_000)
    })
    const got = await Promise.race([call, gaveUp])
    forgetOld(o)
    if (!got || got.status !== 'complete' || stop.signal.aborted || o.closed()) return null
    const raw = readPlan(got.text)
    if (!raw) return null
    // A fact is taken from what the planner was given, but never from where things stood in a scene before that no
    // longer holds here.
    const material = m.reach === 'here' ? user : planMessages({ ...m, stand: '' })[1].content
    const plan = checkPlan(raw, { ...o.check, reach: m.reach, material, card: m.card, calls: m.calls, people: m.people, secrets: m.secrets })
    const text = planText(plan, o.carryingOn)
    if (!text && !plan.needs.length) return null
    return { needs: plan.needs, text, checked: plan.checked }
  } catch (e) {
    console.warn('Could not plan the scene; writing without a plan', e)
    return null
  } finally {
    clearTimeout(timer)
    clearTimeout(late)
    o.signal?.removeEventListener('abort', onAbort)
  }
}

/** Only the scene's newest few planning calls keep their whole prompt. */
function forgetOld(o: Pick<PlanCall, 'db' | 'sceneId' | 'closed'>): void {
  try {
    if (o.db.open && !o.closed()) gens.forgetOldPrompts(o.db, o.sceneId, PLAN_MARKER, KEEP_PLAN_PROMPTS)
  } catch (e) {
    console.warn('Could not let go of older planning prompts', e)
  }
}
