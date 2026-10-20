// Each scene's contract (long story memory fix 13, after ConWriter 2026: drift from the plan and contradictions of what
// is already so are caught best by a narrow, planned checklist, not an open hunt for plot holes; it cut contradictions
// 50–88%). Three short lists, written for the scene being drafted:
//   - Must be true at the start: from the record as of this point (the stage, fix 11's time since the scene before,
//     who knows what), only what the scene's people touch, a handful at most;
//   - Must change: what this draft is asked for, strongest first: the author's direction for it (a whole scene's too),
//     ask by ask and each whole (directionAsks: what happens, how it reads, how long; the direction receipt shows how
//     each came out), then what the plan before writing said must change, checked against the card (plan/plan.ts), then
//     the scene card (its beats; for Add below the next beat, for a beat that beat with the author's note for it), each left out when
//     something stronger already says it; the card's outcome and the plot threads it sets up or pays off keep a place of
//     their own (fix 13's review: the plan never pushes the card out, nor the beats the outcome);
//   - Must not change: the dead stay dead, what is kept from someone stays kept, injuries stay, what someone gave away
//     stays gone and things stay where they were put; never what the change list itself changes (a key handed over, a
//     secret told, someone learning the truth: changedBy), so the contract never goes against itself.
// The first and last lists are written by the app from what must stay true's own lines (mustStay.ts mustLines), word for
// word, so what must stay true leaves them out (`leaveOut`) and nothing is said twice. The contract goes in the writer's
// briefing as a short late block (CONTRACT_BLOCK, after where things stand, before what must stay true), and the check
// as the draft lands goes through it item by item (repair/contract.ts; the chapter writer's checks, checks/run.ts).
// Settings › Models, "Give each scene a contract" (on by default) turns it off; AIWRITE_CONTRACT=off always does. Pure.

import type { CheckKind } from '@shared/contracts/checks'
import type { EntryState, FactState, ID, SceneCard, Settings } from '@shared/types'
import { sinceWords } from '@shared/knowWords'
import { beatsOnPage } from '@shared/beats'
import { namesItem as namesStageItem } from '@shared/stageItems'
import { nameIn, namesItem } from '../memory/items'
import { isPerson, shortPlace, type MustKind, type MustLine } from './mustStay'

/** What the draft is asked to write: a whole scene, a stretch of one (Add below), one beat, or Continue's few paragraphs. */
export type ContractAsks = 'scene' | 'stretch' | 'beat' | 'continue'
export type ContractPart = 'start' | 'change' | 'keep'
/**
 * What one ask of Adam's direction is about (the direction receipt, 2026-10-19): something that happens (an ending too,
 * "end on the knock"), how the words read ("more dialogue"), or how long they are ("keep it under 800 words": the app
 * counts the words itself, so the check never answers it).
 */
export type AskKind = 'event' | 'reads' | 'length'

export interface ContractItem {
  /** Its id in the check (C1...). */
  code: string
  part: ContractPart
  text: string
  /** The check a broken item belongs to, for its issue's kind. */
  check: CheckKind
  /** The codex entries it is about (the people, the item), for the issue's links. */
  entryIds: ID[]
  /** One ask of the author's direction, in the author's own words (the receipt shows how each came out). */
  ask?: AskKind
}

export interface SceneContract {
  asks: ContractAsks
  items: ContractItem[]
}

/** What a draft's briefing is told to build the contract from (ContextInput.contract): null or left out, no contract. */
export interface ContractInput {
  asks: ContractAsks
  /** For a beat: the beat, with Adam's note for it. */
  focus?: string
  /** What the plan before writing said must change, checked against the card (plan/plan.ts); left out: no plan. */
  planned?: string[]
  /**
   * Carrying on from the scene so far without where things stand at its end (it wasn't worked out in time): the contract
   * says nothing must be true where the draft carries on from (review, 2026-10-16), as what held before may not now.
   */
  noStart?: boolean
}

export const CONTRACT_BLOCK = { id: 'scene-contract', title: 'This scene’s contract' } as const
/** The most items in each list: a handful, so the check stays narrow and the briefing short. */
export const CONTRACT_MOST = { start: 4, change: 5, keep: 4 } as const
/** The most "X knows: …" items at the start, and the plot threads among what must change. */
const MOST_KNOWS = 2
const MOST_THREADS = 2
/** The longest an item's words are kept (since when it holds, inside them, is kept whole by mustStay.ts). */
const LONGEST_ITEM = 320

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s: string, most = LONGEST_ITEM): string => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s)

/**
 * Whether drafts get a contract: Adam's switch (Settings › Models, "Give each scene a contract", on unless he turns it
 * off), except that AIWRITE_CONTRACT=off always turns it off (app tests that aren't about it).
 */
export const contractWanted = (settings: Partial<Pick<Settings, 'sceneContracts'>>, env: Record<string, string | undefined> = process.env): boolean =>
  env.AIWRITE_CONTRACT !== 'off' && settings.sceneContracts !== false

// ---------- Words that say what happens ----------

const LITTLE = new Set(
  'that this with from into onto then than there what when where which while about over under after before still just only some more most very back down again once each other will would says said tells told their them they have been were also into upon must here scene beat'.split(
    ' '
  )
)
/** The words of a text that say what happens: four letters or more, no little words, endings taken off. */
export function meaningWords(s: string): Set<string> {
  return new Set(
    clean(s)
      .toLowerCase()
      .replace(/[’']/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !LITTLE.has(w))
      .map((w) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w))
  )
}
const shared = (a: Set<string>, b: Set<string>): number => [...a].filter((w) => b.has(w)).length

/** True when `text` says the fact: enough of the fact's own words (two, or a third of them) are in it. */
export function saysFact(text: string, fact: string): boolean {
  const f = meaningWords(fact)
  if (!f.size) return false
  return shared(f, meaningWords(text)) >= Math.min(f.size, Math.max(2, Math.ceil(f.size / 3)))
}

/**
 * True when most of an item's words (three in five, names aside: the people are named everywhere) are in `text`: it is
 * likely there, in the words as written.
 */
export function mostlyIn(item: string, text: string): boolean {
  const w = meaningWords(item.replace(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}’'-]*/gu, ' '))
  if (!w.size) return false
  return shared(w, meaningWords(text)) >= Math.ceil(w.size * 0.6)
}

/** Words that say how a passage reads, not what happens in it ("make it darker", "more dialogue, a faster pace"). */
const TONE = new Set(
  (
    'dark darker darkest bleak bleaker grim grimmer light lighter bright brighter warm warmer cold colder cool cooler sad sadder ' +
    'happy happier funny funnier humour humor humorous witty wit playful serious tense tenser tension suspense suspenseful scary ' +
    'scarier creepy creepier eerie spooky ominous menacing dread moody mood atmospheric atmosphere gritty grittier tender softer ' +
    'soft gentle gentler harsh harsher rough rougher romantic sexy sexier steamy steamier sensual intimate intense intensity ' +
    'emotional emotion emotive dramatic subtle subtler quiet quieter loud louder calm calmer angry angrier hopeful lyrical poetic ' +
    'sparse terse spare lean tight tighter punchy punchier crisp crisper vivid descriptive description detail detailed details ' +
    'sensory dialogue pace pacing paced slow slower fast faster quick quicker brisk short shorter long longer simple simpler plain ' +
    'plainer formal casual literary tone voice style prose sentences sentence wording feel feeling flavour flavor texture rhythm ' +
    'adverbs adjectives metaphors cliches clichés fewer'
  ).split(' ')
)
/** The little words a tone-only direction may have besides. */
const TONE_LITTLE = new Set(
  'make it its this that the a an bit little lot much more less most least very far way slightly somewhat rather quite even too so and or but keep give add use cut trim with of in on to up down please overall throughout whole scene passage draft writing write'.split(
    ' '
  )
)

/**
 * True when a direction only says how the words should read, not what should happen ("make it darker", "more dialogue",
 * "tone it down"): it isn't something that must change, and never a "not shown yet" question (review, 2026-10-16). Any
 * other word (a name, a deed) and it is what must happen.
 */
export function toneOnly(direction: string): boolean {
  const words = letterWords(direction)
  return words.some((w) => TONE.has(w)) && words.every((w) => TONE.has(w) || TONE_LITTLE.has(w))
}

const letterWords = (s: string): string[] =>
  clean(s)
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}]+/u)
    .filter(Boolean)

// ---------- A direction, ask by ask (the direction receipt, 2026-10-19) ----------

/** The most asks a direction is split into; whatever is left goes with the last one, whole. */
export const ASKS_MOST = 6

/** A verb that starts an instruction of its own after a comma or "and": "…, end on the knock", "… and make it darker". */
const BIDDING =
  /^(?:then\s+)?(?:end|ends|ending|finish|close|open|start|begin|make|keep|give|add|use|cut|let|have|show|include|write|put|set|bring|slow|speed|focus|stay|avoid|skip|play|linger|don['’]?t|do not|never)\b/i
/** Someone doing something next: a name or a pronoun after "then" ("…, then Tobin leaves"). */
const SUBJECT = /^(?:\p{Lu}[\p{L}’'-]*|he|she|they|it|i|we|you)\b/u
/** Words that end a sentence without ending it ("Mr. Hale"). */
const SHORT_FORM = /\b(?:Mr|Mrs|Ms|Dr|St|Mt|Sr|Jr|Capt|Col|Gen|Lt|Sgt|Prof|Rev)\.$/

const wordCount = (s: string): number => clean(s).split(' ').filter(Boolean).length

/** The clauses of one sentence that ask for something of their own (see directionAsks). */
function clausesOf(sentence: string): string[] {
  // Text and the joins between them: ", ", ", and ", ", then ", " and ", " and then ".
  const parts = sentence.split(/(,\s*(?:and\s+then\s+|and\s+|then\s+)?|\s+and\s+(?:then\s+)?)/i)
  const out: string[] = [parts[0] ?? '']
  for (let i = 1; i < parts.length; i += 2) {
    const join = parts[i]
    const next = parts[i + 1] ?? ''
    const prev = out[out.length - 1]
    const comma = join.includes(',')
    const then = /\bthen\b/i.test(join)
    const bids = BIDDING.test(next)
    // How it reads, on its own after a comma ("…, more dialogue"), or after "and" when it is more than a word.
    const reads = toneOnly(next) && (comma || wordCount(next) > 1)
    const leads = then && SUBJECT.test(next.trim())
    if (wordCount(prev) >= 2 && wordCount(next) >= 2 - (reads ? 1 : 0) && (bids || reads || leads)) out.push(next)
    else out[out.length - 1] = `${prev}${join}${next}`
  }
  return out
}

/** "800" or "1,200" as a number. */
const toNumber = (s: string): number => Number(s.replace(/[,\s]/g, ''))

/**
 * How long an ask says the words should be ("keep it under 800 words": at most 800; "at least 1,500 words"; "about 600
 * words"), or null when it says nothing of length, or more than that besides.
 */
export function lengthAsk(ask: string): { most?: number; least?: number; about?: number } | null {
  const t = clean(ask)
  const n = String.raw`(\d[\d,]*)\s*words?\b`
  const tests: [RegExp, 'most' | 'least' | 'about'][] = [
    [new RegExp(String.raw`\b(?:under|below|less than|fewer than|at most|no more than|not more than|no longer than|max(?:imum)?(?: of)?|up to|within)\s+(?:about\s+|around\s+)?${n}`, 'i'), 'most'],
    [new RegExp(String.raw`\b(\d[\d,]*)\s*words?\s+(?:or\s+(?:less|fewer|under)|at most|max(?:imum)?|tops)\b`, 'i'), 'most'],
    [new RegExp(String.raw`\b(?:at least|over|more than|no fewer than|no less than|min(?:imum)?(?: of)?)\s+${n}`, 'i'), 'least'],
    [new RegExp(String.raw`\b(\d[\d,]*)\s*words?\s+(?:or\s+(?:more|over)|at least|min(?:imum)?)\b`, 'i'), 'least'],
    [new RegExp(String.raw`\b(?:(?:about|around|roughly|some|approximately|near(?:ly)?|close to)\s+)?${n}`, 'i'), 'about']
  ]
  for (const [re, kind] of tests) {
    const m = re.exec(t)
    if (!m) continue
    const value = toNumber(m[1])
    if (!value) return null
    // Only a length: the rest is little words ("keep it", "make the scene") or how it reads ("short and tense").
    const rest = letterWords(t.replace(m[0], ' ')).filter((w) => !/^(?:words?|long|length|total|in|all|or|so|the|scene|stretch|draft|passage|it)$/.test(w))
    if (!rest.every((w) => TONE.has(w) || TONE_LITTLE.has(w))) return null
    return { [kind]: value }
  }
  return null
}

/** True when words of this length keep to a length ask: under or over it as asked, or within a fifth of "about". */
export function keepsLength(ask: NonNullable<ReturnType<typeof lengthAsk>>, words: number): boolean {
  if (ask.most != null) return words <= ask.most
  if (ask.least != null) return words >= ask.least
  if (ask.about != null) return Math.abs(words - ask.about) <= ask.about * 0.2
  return true
}

/** What one ask is about (AskKind). */
export const askKind = (ask: string): AskKind => (lengthAsk(ask) ? 'length' : toneOnly(ask) ? 'reads' : 'event')

/**
 * Adam's direction split into what it asks for, one ask each, each kept whole in his own words (first letter capitalised,
 * the closing full stop off): its sentences (and lines, and parts between semicolons), and inside a sentence a clause
 * that bids something of its own after a comma or "and" ("Make it tense, end on the knock at the door"), says how it
 * should read ("…, more dialogue"), or has someone do something next ("…, then Tobin leaves"). A comma or "and" inside
 * one happening never splits it ("Wren pulls off her boots and sets them by the hearth"). At most ASKS_MOST: the rest
 * goes with the last, whole.
 */
export function directionAsks(direction: string): { text: string; kind: AskKind }[] {
  const lines = (direction ?? '')
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
  const sentences: string[] = []
  for (const line of lines) {
    let held = ''
    for (const piece of line.split(/(?<=[.!?…]["'”’)\]]*)\s+|;\s*/)) {
      const p = `${held}${held ? ' ' : ''}${piece}`.trim()
      if (SHORT_FORM.test(p)) held = p
      else {
        held = ''
        if (p) sentences.push(p)
      }
    }
    if (held) sentences.push(held)
  }
  const tidy = (s: string): string => {
    const t = clean(s).replace(/[\s.,;:]+$/, '')
    return t ? t[0].toLocaleUpperCase() + t.slice(1) : ''
  }
  const asks = sentences.flatMap(clausesOf).map(tidy).filter(Boolean)
  const kept = asks.length > ASKS_MOST ? [...asks.slice(0, ASKS_MOST - 1), asks.slice(ASKS_MOST - 1).join('. ')] : asks
  return kept.map((text) => ({ text, kind: askKind(text) }))
}

// ---------- Building it ----------

export interface ContractFrom {
  asks: ContractAsks
  /**
   * What must stay true's lines (mustStay.ts mustLines), the full form with every stage line told (stageShown off): the
   * start and what must not change are taken from them, word for word.
   */
  must: MustLine[]
  /** The characters in the scene (the card, point of view first). */
  people: Pick<EntryState, 'id' | 'name' | 'kind' | 'aliases' | 'summary' | 'tags' | 'fields'>[]
  card: Pick<SceneCard, 'beats' | 'outcome'>
  /** The plot threads on the card still open here (ai/context.ts Selection.threads). */
  threads: { entryId: ID; name: string; role: 'sets up' | 'pays off' }[]
  /** Adam's direction (Add below), or Continue's "what happens next". */
  direction: string
  /** The words already in the scene the draft carries on from (Add below: the beats already written). */
  soFar?: string
  focus?: string
  planned?: string[]
  /** Who knows what at this point, and the story's title (since when, without it). */
  facts: FactState[]
  storyTitle: string
  /**
   * Where things stand at this same moment is told right above (carrying on inside a scene: Add below, a later beat,
   * Continue): the start leaves out where people are and what they hold or have on, which the stage says word for word
   * (the check of the new words compares with the stage itself).
   */
  stageShown?: boolean
  /** Nothing at the start: carrying on with no stage for the scene so far's end (ContractInput.noStart). */
  noStart?: boolean
}

/** Where a line of what must stay true goes in the contract, and in what order (lower first); null: not in it. */
const START_ORDER: Partial<Record<MustKind, number>> = { elapsed: 0, where: 1, holding: 2, wearingNamed: 3, posture: 4 }
const KEEP_ORDER: Partial<Record<MustKind, number>> = {
  dead: 0,
  rule: 0.5,
  gap: 1,
  condition: 2,
  belief: 3,
  goneNamed: 4,
  gotNamed: 5,
  thingNamed: 6,
  thing: 7,
  gone: 8,
  got: 9,
  marks: 10
}
/** The check a broken item of each kind belongs to. */
const CHECK_OF: Partial<Record<MustKind, CheckKind>> = {
  elapsed: 'timeline',
  where: 'continuity',
  holding: 'continuity',
  wearingNamed: 'continuity',
  posture: 'continuity',
  thingNamed: 'continuity',
  thing: 'continuity',
  gap: 'knowledge',
  belief: 'knowledge'
}

/**
 * What must change (see the top of this file): the author's direction, ask by ask, then the plan's words, then the card's
 * (or the beat), each left out when something before it already says it; then the card's outcome and the plot threads,
 * which keep their places however many beats there are. The direction's asks each have a place of their own, each whole
 * (the direction receipt, 2026-10-19: one item cut at 320 characters said nothing of which ask landed); the rest share
 * CONTRACT_MOST.change, the direction counting as one (the writer reads it as one line pointing to where it is said).
 */
export function mustChange(
  o: Pick<ContractFrom, 'asks' | 'card' | 'threads' | 'direction' | 'soFar' | 'focus' | 'planned'>
): { text: string; entryIds: ID[]; ask?: AskKind }[] {
  type Item = { text: string; entryIds: ID[]; ask?: AskKind }
  const plain = (t: string): Item => ({ text: clip(clean(t)), entryIds: [] })
  const beats = o.card.beats.map(clean).filter(Boolean)
  // What the draft is asked for in the author's own words (Continue's "what happens next", Add below's direction, a whole
  // scene's direction), ask by ask. How it should read ("make it darker", "more dialogue") and how long it should be are
  // asks of a draft only (Generate, Add below, which show the receipt): Continue's are left out, as before. A direction
  // with nothing that happens in it leaves the card's words standing.
  const asks = o.asks === 'beat' ? [] : directionAsks(o.direction).filter((a) => a.kind === 'event' || o.asks === 'scene' || o.asks === 'stretch')
  const happens = asks.some((a) => a.kind === 'event')
  const direction = happens ? clean(o.direction) : ''
  // ...and what the card asks (a beat: that beat with the author's note for it).
  const card =
    o.asks === 'beat'
      ? clean(o.focus)
        ? [plain(o.focus!)]
        : []
      : o.asks === 'stretch'
        ? !direction && beats[beatsOnPage(beats, o.soFar)]
          ? [plain(beats[beatsOnPage(beats, o.soFar)])]
          : []
        : o.asks === 'scene'
          ? beats.map(plain)
          : []
  const outcome = o.asks === 'scene' && clean(o.card.outcome) ? [plain(`By the end: ${clean(o.card.outcome)}`)] : []
  const threads =
    o.asks === 'scene'
      ? o.threads.slice(0, MOST_THREADS).map((t) => ({
          text: `The plot thread “${clean(t.name)}” is ${t.role === 'pays off' ? 'paid off' : 'set up'}.`,
          entryIds: [t.entryId]
        }))
      : []
  const planned = (o.planned ?? []).map(clean).filter(Boolean).map(plain)
  // Each source in turn, left out where an earlier one already says it (the plan's "They reach the gate by dusk" stands
  // for the card's "They reach the gate."). A thread stands unless the author or the plan names it. The direction is
  // weighed whole, as before it was split.
  const said: string[] = direction ? [direction] : []
  const seen = new Set<string>()
  const take = (list: Item[], against: () => string[] = () => said): Item[] => {
    const out = list.filter((x) => {
      const k = x.text.toLowerCase()
      if (!x.text || seen.has(k) || against().some((p) => saysFact(p, x.text))) return false
      seen.add(k)
      return true
    })
    said.push(...out.map((x) => x.text))
    return out
  }
  // Every ask stands, each in the author's words (only the same words twice are said once).
  const fromAsked = take(
    asks.map((a) => ({ text: a.text, entryIds: [], ask: a.kind })),
    () => []
  )
  const fromPlan = take(planned)
  const named = [...said]
  // The outcome before the beats: a beat that only says it again is the one left out.
  const end = take(outcome)
  const fromCard = take(card)
  const extra = take(threads, () => named)
  // The asks, the outcome and the threads keep their places; the plan and the card share what is left, the direction
  // counting as one.
  const room = Math.max(0, CONTRACT_MOST.change - end.length - extra.length - (fromAsked.length ? 1 : 0))
  return [...fromAsked, ...[...fromPlan, ...fromCard].slice(0, room), ...end, ...extra]
}

/**
 * The scene's contract (see the top of this file); null when it would say nothing. Codes run C1... through the start,
 * what must change and what must not.
 */
export function sceneContract(o: ContractFrom): SceneContract | null {
  const change = mustChange(o)
  const changeText = change.map((c) => c.text).join('\n')
  const order = (l: MustLine, by: Partial<Record<MustKind, number>>): number => by[l.kind] ?? Infinity
  const pick = (by: Partial<Record<MustKind, number>>, most: number, drop: (l: MustLine) => boolean = () => false): MustLine[] =>
    o.must
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => order(l, by) !== Infinity && !drop(l))
      .sort((a, b) => order(a.l, by) - order(b.l, by) || a.i - b.i)
      .slice(0, most)
      .map(({ l }) => l)

  // At the start: how much time has passed, where people are, what they hold or have off; then who knows what the scene
  // is about (not a secret among those here: that is what must not change).
  const startLines = pick(o.stageShown ? { elapsed: 0 } : START_ORDER, CONTRACT_MOST.start)
  const about = [o.card.beats.join('\n'), o.card.outcome, o.direction, o.focus ?? '', changeText].map(clean).filter(Boolean).join('\n')
  const here = o.people.filter(isPerson)
  const knows: { text: string; entryIds: ID[] }[] = []
  for (const f of [...o.facts].sort((a, b) => (b.at ?? -2) - (a.at ?? -2))) {
    if (knows.length >= MOST_KNOWS) break
    if (f.backed === false || !saysFact(about, f.fact)) continue
    const knowers = here.filter((p) => f.knownBy.includes(p.id))
    // Known by everyone here, or by no one: no secret, and the one who knows it is who it is about.
    if (!knowers.length || knowers.length < here.length) continue
    const who = knowers[0]
    const since = sinceWords(f.since?.[who.id], (w) => shortPlace(w, o.storyTitle))
    const name = knowers.length === 1 ? who.name : `${knowers.slice(0, -1).map((p) => p.name).join(', ')} and ${knowers[knowers.length - 1].name}`
    knows.push({ text: clip(`${name} ${knowers.length === 1 ? 'knows' : 'know'}: ${clean(f.fact).replace(/[.]$/, '')}${since ? ` (${since})` : ''}`), entryIds: knowers.map((p) => p.id) })
  }
  const start = o.noStart
    ? []
    : [
        ...startLines.map((l) => ({ text: l.text, check: CHECK_OF[l.kind] ?? ('facts' as CheckKind), entryIds: l.entryIds })),
        ...knows.map((k) => ({ ...k, check: 'knowledge' as CheckKind }))
      ].slice(0, CONTRACT_MOST.start)

  // Must not change: never what the change list itself changes (changedBy), so the contract never goes against itself.
  const keep = pick(KEEP_ORDER, CONTRACT_MOST.keep, (l) => changedBy(l, change.map((c) => c.text)))

  const items: ContractItem[] = []
  const put = (part: ContractPart, text: string, check: CheckKind, entryIds: ID[], ask?: AskKind): void => {
    if (!clean(text) || items.some((x) => x.text === text)) return
    items.push({ code: `C${items.length + 1}`, part, text, check, entryIds, ...(ask ? { ask } : {}) })
  }
  for (const s of start) put('start', s.text, s.check, s.entryIds)
  for (const c of change) put('change', c.text, 'facts', c.entryIds, c.ask)
  for (const k of keep) put('keep', k.text, CHECK_OF[k.kind] ?? 'facts', k.entryIds)
  return items.length ? { asks: o.asks, items } : null
}

/** Words that say someone comes to know something: they learn it, find it out, are told it, see through it. */
const LEARNS =
  /\b(?:learn(?:s|ed|t)?|discover(?:s|ed)?|finds? out|found out|realis(?:e|es|ed)|realiz(?:e|es|ed)|works? out|worked out|is told|was told|hears?|heard|sees? through|saw through|guess(?:es|ed)|understands?|understood|uncovers?|uncovered)\b/i
/** True when the words have someone tell `name` something ("Mara tells Tobin", "admits to Tobin"). */
function toldTo(text: string, name: string): boolean {
  const names = [...new Set([clean(name), clean(name).split(' ')[0]])].filter((n) => n.length >= 2)
  return names.some((n) =>
    new RegExp(
      `\\b(?:tells?|told|shows?|showed|warns?|warned|(?:reveals?|revealed|admits?|admitted|confess(?:es|ed)?|explains?|explained) to)\\s+${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i'
    ).test(text)
  )
}
/** Words that say a belief was wrong. */
const TRUTH = /\b(?:truth|true|lie|lies|lied|lying|wrong|mistaken)\b/i

/** A line's own words, without who it is about ("Mara: ") or since when it holds ("(since Ch 2, Sc 1)"). */
const ownWords = (text: string): string => text.replace(/^[^:]{1,60}:\s*/, '').replace(/\s*\([^()]*\)[\s\S]*$/, '')

/**
 * True when what must change would change what a line of what must stay true says, so it can't also be something that
 * must not change: the change names the item someone has or gave away, or the thing in the place; or it says the line's
 * own words (saysFact); and for a secret or a wrong belief, it says the one it is kept from, or who believes it, learns or
 * is told it (with a word of it), or learns the truth.
 */
export function changedBy(line: Pick<MustLine, 'text' | 'about'>, change: string[]): boolean {
  const all = change.join('\n')
  if (!clean(all)) return false
  const a = line.about
  if (a && 'holding' in a) return namesItem(all, a.holding)
  if (a && 'thing' in a) return namesStageItem(all, a.thing)
  const words = a ? a.words : ownWords(line.text)
  if (saysFact(all, words)) return true
  if (!a) return false
  if (!a.learns) return false
  const own = meaningWords(words)
  return change.some(
    (c) => a.who.some((n) => (nameIn(c, n) && LEARNS.test(c)) || toldTo(c, n)) && (shared(own, meaningWords(c)) >= 1 || TRUTH.test(c))
  )
}

// ---------- How it is told ----------

/** What the writer is told first. */
export const CONTRACT_LEAD = 'What this scene must keep to and bring about. Once it is written, the draft is checked against it, item by item.'

/** The heading of each list, by what the draft is asked to write. */
export function partTitle(part: ContractPart, asks: ContractAsks): string {
  if (part === 'start') return asks === 'scene' ? 'Must be true at the start' : 'Must be true where you carry on from'
  if (part === 'keep') return 'Must not change'
  return asks === 'scene'
    ? 'Must change by the end of the scene'
    : asks === 'beat'
      ? 'Must change by the end of this beat'
      : asks === 'continue'
        ? 'Must happen next'
        : 'Must happen in what you write now'
}

/**
 * What the writer is told in place of an item it reads in full elsewhere in the same request (2026-10-19: Adam's
 * direction was said three or four times in one request): the item's words, and what to say instead.
 */
export interface SaidElsewhere {
  text: string
  as: string
}

/**
 * The pointers for the direction and a beat, by where the writer reads them in full. Since 2026-10-19 a whole scene's
 * direction is said last of all too (Generate's closing instruction), so `card` is only for a draft whose closing is its
 * own (Beat by beat keeps the direction on the scene card).
 */
export const SAID = {
  card: 'What the author directs, as the scene card gives it.',
  below: 'What the author directs, as given last of all, below.',
  beat: 'This beat, as given last of all, below.',
  next: 'What the author asks for next, as given last of all, below.'
} as const

/**
 * The lists as the writer reads them (short: without the lead), or with ids for a check (`codes`). `said`: items the
 * writer reads in full elsewhere in the request (the direction last of all, or on the scene card) are pointed to rather
 * than said again, the direction's asks with one line; never in a check's list. A check's list leaves out the asks of
 * length, which the app counts itself (repair/contract.ts).
 */
export function contractText(c: SceneContract, o: { short?: boolean; codes?: boolean; said?: readonly SaidElsewhere[] } = {}): string {
  const parts: string[] = []
  if (!o.short && !o.codes) parts.push(CONTRACT_LEAD)
  const pointers = (o.codes ? [] : (o.said ?? []))
    .filter((s) => clean(s.text))
    .map((s) => {
      const whole = clean(s.text)
      return { as: s.as, texts: new Set([whole, clip(whole), ...directionAsks(whole).map((a) => a.text)].map((t) => t.toLowerCase())) }
    })
  const pointed = new Set<string>()
  for (const part of ['start', 'change', 'keep'] as const) {
    const lines: string[] = []
    for (const i of c.items.filter((x) => x.part === part)) {
      if (o.codes) {
        if (i.ask !== 'length') lines.push(`- [${i.code}] ${i.text}`)
      } else if (part !== 'change') lines.push(`- ${i.text}`)
      else {
        const to = pointers.find((p) => p.texts.has(i.text.toLowerCase()))?.as
        if (to && pointed.has(to)) continue
        if (to) pointed.add(to)
        lines.push(`${lines.length + 1}. ${to ?? i.text}`)
      }
    }
    if (lines.length) parts.push(`${partTitle(part, c.asks)}:\n${lines.join('\n')}`)
  }
  return parts.join('\n')
}

/** The lines of the start and what must not change, word for word: what must stay true leaves them out. */
export const contractSays = (c: SceneContract | null | undefined): Set<string> => new Set((c?.items ?? []).filter((i) => i.part !== 'change').map((i) => i.text))
