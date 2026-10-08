// The briefing for an Ask the world question: what the chat and brainstorm model is given about the
// world, from the open story's point of view (spec, Ask the world; Multi-story rules). The memory is
// read as it stands at the open scene, its own changes included (at the story's end when no scene is
// open, or the world as it was set up when no story is), along the same line a draft of that scene
// would use, so an own version of events never reaches another story's chat. No Electron imports.
//
// What is given, most important first (each block has shorter forms; when the model can't read it
// all, blocks are shortened from the bottom up and then left out, as a draft's briefing is):
//   1 how to answer, with the style guide            never left out
//   2 where the author is in the story                never left out
//   3 entries named in the question (or earlier in the chat), in full as of this point
//   4 the conversation so far (the latest turns are kept longest)
//   5 the open scene: its card and who is in it
//   6 the world's rules
//   7 entries the search finds for the question's words, and Adam's pins
//   8 the story so far
//   9 everything else in the memory, a line each (so any of it can be named)
//  10 themes, tone and premise
// Entries named in the question come in even when they come later in this story itself ("not in the
// story yet at this point"), labelled so. One that first exists in another story on this story's way,
// past the point this story leaves it (a main book's later chapters, seen from a what-if or a prequel),
// never comes in this story: it is only named, with drafting's label ("from Book 1, not in this story so
// far"). Nothing from a story this one doesn't know of ever comes in. Entries Adam keeps out ('hide'
// pins) are left out everywhere, as in a draft, unless the question names them.

import type Database from 'better-sqlite3'
import type {
  AsOf,
  ChatMessage,
  ContextBlock,
  ContextBudget,
  EntryState,
  FactState,
  ID,
  Pin,
  RelationshipState,
  ThreadState,
  WritingPrefs
} from '@shared/types'
import { ENTRY_KINDS, KIND_LABELS } from '@shared/fields'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { memoryAt } from '../memory/asOf'
import { knowsSentence, labeler } from '../memory/line'
import { loadMemoryData, loadShape, sceneMemory, writerData } from '../memory/scene'
import type { MemoryData, StoryNode, StorySoFar, WorldShape } from '../memory/types'
import { searchIndex } from '../search'
import {
  blockAsSent,
  computeBudget,
  effectivePins,
  finishContext,
  formatProfile,
  formsOf,
  happenedText,
  mentions,
  oneLine,
  sentEntryIds,
  STORY_LEVELS,
  storySoFarText,
  WHY,
  type BlockDraft,
  type PreparedContext
} from '../ai/context'
import { askInstructions, askMessages, conversationText, type PastTurn } from './prompts'

type DB = Database.Database

/** The length of answer the briefing leaves room for, in words (about 1,500 tokens). */
export const REPLY_WORDS = 800
/** The most earlier turns of a chat ever sent. */
export const MAX_TURNS = 12
/** The most entries the search adds for the question's words. */
export const SEARCH_LIMIT = 6

/** Why an entry is in the briefing, in plain words ("What the AI saw" lists them by block). */
export const ASK_WHY = {
  question: 'Named in your question',
  chat: 'Named earlier in this chat',
  scene: 'In the open scene',
  search: 'Matches words in your question',
  rule: WHY.rule
} as const

export const NOT_YET = 'not in the story yet at this point'

/** The label of an entry named only earlier in the chat, so the AI doesn't take it for one the question names. */
export const EARLIER = 'named earlier in this chat'

export interface AskContextInput {
  question: string
  /** The open story and scene; either may be null. */
  storyId: ID | null
  sceneId: ID | null
  /** The chat's earlier turns, oldest first. */
  turns: PastTurn[]
  prefs: WritingPrefs
  /** The chat model's context length; null when unknown. */
  contextLength: number | null
}

/** The point the question is asked from, and the memory there. */
export interface AskPoint {
  story: StoryNode | null
  /** The open scene, when it is in the open story. */
  sceneId: ID | null
  /** "Book 1, Ch 2, Sc 3", "End of Book 2", or '' with no story. */
  label: string
  /** Every entry that exists here, as of here. */
  here: Map<ID, EntryState>
  /** Entries that come later in this story itself ("not in the story yet at this point"). */
  later: Map<ID, EntryState>
  /**
   * Entries from another story on this story's way that this story never reaches (that story goes on
   * past the point this one leaves it), with drafting's label: "from Book 1, not in this story so far".
   * Only ever named, never described: what they are belongs to events this story doesn't know.
   */
  elsewhere: Map<ID, { entry: EntryState; label: string }>
  relationships: RelationshipState[]
  facts: FactState[]
  threads: ThreadState[]
  /** "This story knows what happened in: ...". */
  knows: string
  storySoFar: StorySoFar | null
  /** The open scene's own summary (or, with no scene open, the story's last scene's). */
  lastSummary: { label: string; text: string } | null
  /** Every entry's name, for relationships (names alone are never story facts). */
  names: Map<ID, string>
}

export interface AskBriefing {
  messages: ChatMessage[]
  /** Every block, as "What the AI saw" shows them (left-out ones too). */
  blocks: ContextBlock[]
  /** Each entry sent, with the version that was sent. */
  entries: { entryId: ID; version: string }[]
  budget: ContextBudget
  /** Where the answer is from, in plain words. */
  label: string
  /** The story the answer is from (the open scene's), or null. */
  storyId: ID | null
  sceneId: ID | null
  /** How many earlier turns were sent. */
  turnsSent: number
}

// ---------- Where the question is asked from ----------

const clean = (s: string | null | undefined): string => (s ?? '').trim()

/** Ends a phrase with a full stop unless it already ends with punctuation. */
const sentence = (s: string): string => (/[.!?…:;]["'”’)\]]*$/.test(s) ? s : `${s}.`)

/** True when a story is an own version of events, or follows on from one: what happens in it reaches no other story. */
export function standsAlone(shape: WorldShape, storyId: ID | null): boolean {
  const byId = new Map(shape.stories.map((s) => [s.id, s]))
  const seen = new Set<ID>()
  for (let s = storyId ? byId.get(storyId) : undefined; s && !seen.has(s.id); s = s.startStoryId ? byId.get(s.startStoryId) : undefined) {
    seen.add(s.id)
    if (s.kind === 'own') return true
  }
  return false
}

const lastScene = (story: StoryNode): ID | null => story.chapters.flatMap((c) => c.scenes).at(-1)?.id ?? null

/** Where a question is asked from: a story and the point in it the memory is read at. */
export interface AskedFrom {
  story: StoryNode
  /** The open scene, when it is in that story. */
  sceneId: ID | null
  /** Just after the open scene (its own changes included), else the story's end. */
  at: AsOf
}

/** The open scene's story (else the open story) and the point in it; null with no story open. */
export function askedFrom(shape: WorldShape, storyId: ID | null, sceneId: ID | null): AskedFrom | null {
  const sceneStory = sceneId ? shape.stories.find((s) => s.chapters.some((c) => c.scenes.some((x) => x.id === sceneId))) : undefined
  const story = sceneStory ?? (storyId ? shape.stories.find((s) => s.id === storyId) : undefined)
  if (!story) return null
  const open = sceneStory && sceneId ? sceneId : null
  return { story, sceneId: open, at: open ? { kind: 'scene', storyId: story.id, sceneId: open } : { kind: 'end', storyId: story.id } }
}

/**
 * The memory at the point the question is asked from. `shape` and `data` may be passed in when
 * they have just been read.
 */
export function askPoint(
  db: DB,
  storyId: ID | null,
  sceneId: ID | null,
  shape: WorldShape = loadShape(db),
  data: MemoryData = writerData(db, loadMemoryData(db))
): AskPoint {
  const names = new Map(data.entries.map((e) => [e.id, e.name]))
  const place = askedFrom(shape, storyId, sceneId)
  if (!place) {
    // No story open: the world as it was set up, before any story.
    const here = new Map<ID, EntryState>(data.entries.map((e) => [e.id, { ...e, happened: [], changed: [] }]))
    return {
      story: null,
      sceneId: null,
      label: '',
      here,
      later: new Map(),
      elsewhere: new Map(),
      relationships: [],
      facts: [],
      threads: [],
      knows: '',
      storySoFar: null,
      lastSummary: null,
      names
    }
  }
  const { story, sceneId: openScene, at } = place
  const m = memoryAt(db, at, shape, data)

  // Entries not there yet. One that first exists later in this story itself comes in when named
  // ("not in the story yet at this point"). One from another story on this story's way is somewhere
  // this story never reaches (it leaves that story before it comes): only its name, with drafting's
  // label. Never one from a story this one doesn't know of.
  const onWalk = new Set(m.line.segments.map((s) => s.storyId))
  const titles = new Map(shape.stories.map((s) => [s.id, s.title]))
  const sceneStoryOf = new Map<ID, ID>()
  for (const s of shape.stories) for (const c of s.chapters) for (const sc of c.scenes) sceneStoryOf.set(sc.id, s.id)
  const homes = new Map<ID, (ID | null)[]>()
  for (const p of data.exists) {
    const home = p.kind === 'scene' && p.sceneId ? (sceneStoryOf.get(p.sceneId) ?? p.storyId) : p.storyId
    homes.set(p.entryId, [...(homes.get(p.entryId) ?? []), home])
  }
  const later = new Map<ID, EntryState>()
  const elsewhere = new Map<ID, { entry: EntryState; label: string }>()
  for (const [id, e] of m.state.absent) {
    const where = homes.get(id) ?? []
    if (where.includes(story.id)) {
      later.set(id, e)
      continue
    }
    const from = where.find((h): h is ID => !!h && onWalk.has(h) && titles.has(h))
    if (from) elsewhere.set(id, { entry: e, label: `from ${titles.get(from)}, not in this story so far` })
  }

  // The story so far: up to the open scene (or the story's last), then that scene's own summary.
  const upTo = openScene ?? lastScene(story)
  const sm = upTo ? sceneMemory(db, upTo, { forWriter: true }) : null
  const summary = upTo ? clean(mem.getSummary(db, 'scene', upTo)?.text) : ''
  return {
    story,
    sceneId: openScene,
    label: m.label,
    here: m.state.entries,
    later,
    elsewhere,
    relationships: m.state.relationships,
    facts: m.state.facts,
    threads: m.state.threads,
    knows: openScene && sm ? sm.knows : knowsSentence(shape, m.line),
    storySoFar: sm?.storySoFar ?? null,
    lastSummary: upTo && summary ? { label: labeler(shape)({ storyId: story.id, sceneId: upTo }), text: summary } : null,
    names
  }
}

// ---------- What goes in ----------

interface Chosen {
  entry: EntryState
  why: string
  /** "not in the story yet at this point", "from Book 1, not in this story so far" or "named earlier in this chat". */
  label: string | null
  /** Only its name is given (an entry from a story this one leaves before it comes). */
  nameOnly?: boolean
}

const STOP = new Set(
  `the and but for with what which who whom whose when where why how would could should did does doing done has have had having was were are
  is been being any some all that this these those there their theirs them they she her hers him his its you your yours our ours about from
  into onto than then give gave tell told say said says make made list ten five three four two one six seven eight nine twenty few more most
  already still ever never name names named fit fits fitting idea ideas like just also very much many can will shall may might must not yes let
  get got want wants need needs think know knew knows something anything everything someone anyone other others another way ways good best kind
  sort thing things please could whether while again only own each every here now new old`.split(/\s+/)
)

/** The words of a question worth searching the memory for, at most eight. */
export function searchTerms(question: string): string[] {
  const out: string[] = []
  for (const w of question.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    const k = w.replace(/['’]s$/i, '').toLocaleLowerCase()
    if (k.length < 3 || STOP.has(k) || /^\d+$/.test(k) || out.includes(k)) continue
    out.push(k)
  }
  return out.slice(0, 8)
}

/** True when any of the entry's names appears in the text. */
const namedIn = (text: string, e: EntryState): boolean => !!text.trim() && [e.name, ...(e.aliases ?? [])].some((n) => mentions(text, n))

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where in the text any of the entry's names first appears (as `mentions` finds them); Infinity when none does. */
function firstMention(text: string, e: EntryState): number {
  let best = Infinity
  for (const raw of [e.name, ...(e.aliases ?? [])]) {
    const n = raw.trim()
    if (n.length < 2 || !mentions(text, n)) continue
    const flags = /\s/.test(n) || !/^\p{Lu}/u.test(n) ? 'iu' : 'u'
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, flags).exec(text)
    if (m && m.index < best) best = m.index
  }
  return best
}

/** The pins that apply where the question is asked: the scene's own, the story's and the world's. */
function pinsAt(db: DB, point: AskPoint): Pin[] {
  if (point.sceneId) return mem.pinsForScene(db, point.sceneId)
  const any = point.story ? point.story.chapters.flatMap((c) => c.scenes)[0]?.id : undefined
  return mem.pinsForScene(db, any ?? '').filter((p) => p.scope !== 'scene')
}

interface Selection {
  named: Chosen[]
  cast: Chosen[]
  rules: Chosen[]
  related: Chosen[]
  /** Entries Adam keeps out here ('hide' pins) that the question doesn't name: never sent, not even by name. */
  keptOut: Set<ID>
}

function selectEntries(db: DB, point: AskPoint, question: string, turns: PastTurn[]): Selection {
  const chosen = new Map<ID, Chosen>()
  /** Adds an entry to `list` for a reason, once. */
  const take = (list: Chosen[], e: EntryState | undefined, why: string, label: string | null = null, nameOnly = false): void => {
    if (!e || chosen.has(e.id)) return
    const c: Chosen = nameOnly ? { entry: e, why, label, nameOnly } : { entry: e, why, label }
    chosen.set(e.id, c)
    list.push(c)
  }
  const pins = effectivePins(pinsAt(db, point))
  const hidden = (id: ID): boolean => pins.get(id)?.action === 'hide'

  // Named in the question, in the order the question names them: what exists here, what comes later in
  // this story (labelled so) and, by name only, what this story never reaches. Adam asked about them, so
  // a pin keeping one out doesn't count.
  const named: Chosen[] = []
  const away = [...point.elsewhere.values()]
  const inQuestion = [...point.here.values(), ...point.later.values(), ...away.map((x) => x.entry)]
    .map((e) => ({ e, at: firstMention(question, e) }))
    .filter((x) => x.at < Infinity)
    .sort((a, b) => a.at - b.at)
  for (const { e } of inQuestion) {
    const far = point.elsewhere.get(e.id)
    if (far) take(named, e, ASK_WHY.question, far.label, true)
    else take(named, e, ASK_WHY.question, point.here.has(e.id) ? null : NOT_YET)
  }
  // Named in the last two turns, so "What would she do then?" still knows who she is.
  const recent = turns
    .slice(-2)
    .map((t) => `${t.question}\n${t.answer}`)
    .join('\n')
  for (const e of point.here.values()) if (!hidden(e.id) && namedIn(recent, e)) take(named, e, ASK_WHY.chat, EARLIER)

  // Who and what the open scene's card names.
  const cast: Chosen[] = []
  if (point.sceneId) {
    const card = repo.getScene(db, point.sceneId).card
    for (const id of [card.povId, ...card.presentIds, card.locationId]) if (id && !hidden(id)) take(cast, point.here.get(id), ASK_WHY.scene)
  }

  const rules: Chosen[] = []
  for (const e of point.here.values()) if (e.kind === 'lore' && e.hardRule && !hidden(e.id)) take(rules, e, ASK_WHY.rule)

  // What the search finds for the question's words (found by more of the words first), then Adam's pins.
  const related: Chosen[] = []
  const terms = searchTerms(question)
  if (terms.length) {
    const ix = searchIndex(db)
    const score = new Map<ID, number>()
    for (const t of terms) {
      for (const g of ix.search(t, { limit: SEARCH_LIMIT, storyId: point.story?.id ?? null }).groups) {
        for (const h of g.hits) if (h.open.kind === 'entry') score.set(h.open.entryId, (score.get(h.open.entryId) ?? 0) + 1)
      }
    }
    const found = [...score].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    for (const id of found) {
      if (related.length >= SEARCH_LIMIT) break
      if (!hidden(id)) take(related, point.here.get(id), ASK_WHY.search)
    }
  }
  for (const p of pins.values()) if (p.action === 'pin') take(related, point.here.get(p.entryId), WHY.pin[p.scope])

  const keptOut = new Set([...pins.values()].filter((p) => p.action === 'hide' && !chosen.has(p.entryId)).map((p) => p.entryId))
  return { named, cast, rules, related, keptOut }
}

// ---------- The blocks ----------

const kindWord = (e: EntryState): string => KIND_LABELS[e.kind]?.one.toLowerCase() ?? 'entry'

const heading = (c: Chosen): string => `### ${c.entry.name} (${[kindWord(c.entry), c.label].filter(Boolean).join('; ')})`

/** The named entries' title says where they were named: in the question, earlier in the chat, or both. */
function namedTitle(named: Chosen[]): string {
  const inQuestion = named.some((c) => c.why === ASK_WHY.question)
  const earlier = named.some((c) => c.why === ASK_WHY.chat)
  if (!earlier) return 'Named in the question'
  return inQuestion ? 'Named in the question or earlier in this chat' : 'Named earlier in this chat'
}

function relationLine(r: RelationshipState, name: (id: ID) => string): string {
  const parts = [`${name(r.aId)} and ${name(r.bId)}: ${sentence(clean(r.type) || 'linked')}`]
  if (clean(r.aFeels)) parts.push(`${name(r.aId)} feels: ${sentence(clean(r.aFeels))}`)
  if (clean(r.bFeels)) parts.push(`${name(r.bId)} feels: ${sentence(clean(r.bFeels))}`)
  return parts.join(' ')
}

/** Where a plot thread stands here. */
function threadLine(point: AskPoint, e: EntryState): string {
  if (e.kind !== 'thread') return ''
  const t = point.threads.find((x) => x.entryId === e.id)
  if (!t) return ''
  if (t.status === 'resolved') return `Paid off${clean(t.paidOff) ? ` in ${clean(t.paidOff)}` : ''}.`
  return `Still open${clean(t.setUp) ? `, set up in ${clean(t.setUp)}` : ''}.`
}

/**
 * An entry as of this point: 0 the whole profile, everything that has happened to it, its ties and what
 * it knows; 1 without the backstory, the last three things that happened and at most six ties and facts.
 */
function profileText(point: AskPoint, c: Chosen, level: 0 | 1): string {
  // From a story this one never reaches: what it is belongs to events this story doesn't know.
  if (c.nameOnly) return heading(c)
  const e = c.entry
  const name = (id: ID): string => point.names.get(id) ?? 'Someone'
  const ties = point.relationships.filter((r) => r.aId === e.id || r.bId === e.id).map((r) => `- ${relationLine(r, name)}`)
  const knows = point.facts.filter((f) => f.knownBy.includes(e.id) && clean(f.fact)).map((f) => `- ${sentence(clean(f.fact))}`)
  const cap = <T>(xs: T[]): T[] => (level === 0 ? xs : xs.slice(-6))
  const parts = [
    formatProfile(e, heading(c), undefined, level === 1),
    threadLine(point, e),
    happenedText(e, level === 0 ? undefined : 3),
    ties.length ? `Relationships:\n${cap(ties).join('\n')}` : '',
    knows.length ? `What ${e.name} knows:\n${cap(knows).join('\n')}` : ''
  ]
  return parts.filter(Boolean).join('\n\n')
}

const lineOf = (point: AskPoint, c: Chosen): string => {
  const note = [kindWord(c.entry), c.label].filter(Boolean).join('; ')
  if (c.nameOnly) return `- ${c.entry.name} (${note})`
  const status = threadLine(point, c.entry)
  return `- ${oneLine(c.entry, note)}${status ? ` ${status}` : ''}`
}

/** The point as the briefing shows it: what Adam keeps out here isn't named anywhere, not even in another entry's ties. */
function withoutKeptOut(point: AskPoint, out: Set<ID>): AskPoint {
  if (!out.size) return point
  return {
    ...point,
    here: new Map([...point.here].filter(([id]) => !out.has(id))),
    relationships: point.relationships.filter((r) => !out.has(r.aId) && !out.has(r.bId))
  }
}

/** A block with its forms, longest first; each form is kept only when shorter than the one before. */
function block(id: string, priority: number, title: string, forms: (string | null | undefined)[], entryIds: ID[] = []): BlockDraft | null {
  const kept: string[] = []
  for (const f of forms) {
    const t = clean(f)
    if (t && (!kept.length || t.length < kept[kept.length - 1].length)) kept.push(t)
  }
  if (!kept.length) return null
  return { id, priority, title, text: kept[0], short: kept[1] ?? null, smaller: kept.slice(2), entryIds }
}

function whereText(db: DB, point: AskPoint, shape: WorldShape): string {
  const s = point.story
  if (!s) return 'No story is open. What follows is the memory of the world as it was set up, before any story.'
  const lines: string[] = []
  if (point.sceneId) {
    const title = clean(repo.getScene(db, point.sceneId).title)
    lines.push(
      `The author is working on ${s.title}, at ${point.label}${title ? ` (“${title}”)` : ''}. What follows is the memory as it stands at that scene, with what has happened in it so far: nothing later in the story is known yet.`
    )
  } else {
    lines.push(
      `The author is working on ${s.title}, with no scene open. What follows is the memory as it stands at the end of ${s.title} as written so far.`
    )
  }
  if (point.knows) lines.push(point.knows)
  if (standsAlone(shape, s.id))
    lines.push(`${s.title} is an own version of events: it shares the world, but what happens in it reaches no other story.`)
  return lines.join('\n')
}

function sceneText(db: DB, point: AskPoint, cast: Chosen[], level: 0 | 1 | 2): string {
  if (!point.sceneId) return ''
  const scene = repo.getScene(db, point.sceneId)
  const card = scene.card
  const name = (id: ID | null): string | null => (id && point.here.get(id)?.name) || null
  const lines: string[] = []
  if (clean(scene.title)) lines.push(`Scene: ${clean(scene.title)}`)
  if (clean(card.when)) lines.push(`When: ${clean(card.when)}`)
  const pov = name(card.povId)
  if (pov) lines.push(`Point of view: ${pov}`)
  const others = card.presentIds
    .filter((id) => id !== card.povId)
    .map(name)
    .filter((n): n is string => !!n)
  if (others.length) lines.push(`Also in the scene: ${others.join(', ')}`)
  const where = name(card.locationId)
  if (where) lines.push(`Where: ${where}`)
  const beats = card.beats.map((b) => b.trim()).filter(Boolean)
  if (beats.length) lines.push(`Beats: ${beats.map((b, i) => `${i + 1}. ${b.replace(/\s+/g, ' ')}`).join(' ')}`)
  for (const [label, v] of [
    ['Goal', card.goal],
    ['Conflict', card.conflict],
    ['Outcome', card.outcome],
    ['Mood', card.mood]
  ] as const) {
    if (clean(v)) lines.push(`${label}: ${clean(v).replace(/\s+/g, ' ')}`)
  }
  const parts = [lines.join('\n')]
  if (level === 0) parts.push(...cast.map((c) => profileText(point, c, 1)))
  else if (level === 1 && cast.length) parts.push(cast.map((c) => lineOf(point, c)).join('\n'))
  return parts.filter(Boolean).join('\n\n')
}

/** Everything else that exists here, a line each (or only the names), grouped by kind. */
function catalogueText(point: AskPoint, skip: Set<ID>, namesOnly: boolean): string {
  const groups: string[] = []
  for (const kind of ENTRY_KINDS) {
    const list = [...point.here.values()].filter((e) => e.kind === kind && !skip.has(e.id)).sort((a, b) => a.name.localeCompare(b.name))
    if (!list.length) continue
    const label = KIND_LABELS[kind].many
    if (namesOnly) {
      groups.push(`${label}: ${list.map((e) => e.name).join(', ')}`)
      continue
    }
    const line = (e: EntryState): string => {
      const also = (e.aliases ?? []).filter((a) => a.trim()).join(', ')
      const summary = clean(e.summary).replace(/\s+/g, ' ')
      const short = summary.length > 160 ? `${summary.slice(0, 159).trimEnd()}…` : summary
      return `- ${e.name}${also ? ` (also: ${also})` : ''}${short ? `: ${short}` : ''}`
    }
    groups.push(`${label}:\n${list.map(line).join('\n')}`)
  }
  return groups.join('\n\n')
}

function themesText(db: DB, point: AskPoint, oneLineOnly: boolean): string {
  const story = point.story ? repo.getStory(db, point.story.id) : null
  const series = story?.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
  const world = { themes: repo.getMeta(db, 'themes') ?? '', tone: repo.getMeta(db, 'tone') ?? '' }
  const pairs: [string, string | undefined][] = [
    ['Story premise', story?.premise],
    ['Story themes', story?.themes],
    ['Story tone', story?.tone],
    ['Series themes', series?.themes],
    ['Series tone', series?.tone],
    ['World themes', world.themes],
    ['World tone', world.tone]
  ]
  if (!oneLineOnly) {
    return pairs
      .filter(([, v]) => clean(v))
      .map(([k, v]) => `${k}: ${clean(v).replace(/\s*\n\s*/g, ' ')}`)
      .join('\n')
  }
  const first = (...vs: (string | undefined)[]): string => clean(vs.find((v) => clean(v))).split(/(?<=[.!?…])\s/)[0] ?? ''
  const themes = first(story?.themes, series?.themes, world.themes)
  const tone = first(story?.tone, series?.tone, world.tone)
  return [themes ? `Themes: ${sentence(themes)}` : '', tone ? `Tone: ${sentence(tone)}` : ''].filter(Boolean).join(' ')
}

function storyText(point: AskPoint, level: number): string {
  const s = point.storySoFar
  const parts: string[] = []
  if (s && point.story) parts.push(storySoFarText(s, point.story.title, level))
  // The scene itself (or the story's last), which the story so far stops just before.
  if (point.lastSummary && level < 3)
    parts.push(`### ${point.sceneId ? 'The open scene so far' : 'The last scene'}\n${point.lastSummary.label}: ${point.lastSummary.text}`)
  return parts.filter((p) => p.trim()).join('\n\n')
}

/** The order the blocks are sent in: what changes least first, the entries the question names last. */
export const ASK_ORDER = [
  'instructions',
  'world-rules',
  'themes',
  'where',
  'story-so-far',
  'catalogue',
  'related',
  'scene',
  'named',
  'conversation'
]

export interface PreparedAsk {
  prepared: PreparedContext
  question: string
  /** The forms of the conversation block, with how many turns each sends. */
  conversation: { text: string; turns: PastTurn[] }[]
  /** Each entry the briefing could send, with its version. */
  versions: Map<ID, string>
  label: string
  storyId: ID | null
  sceneId: ID | null
}

/** Everything the briefing could send, before it is fitted to the model. */
export function prepareAsk(db: DB, input: AskContextInput): PreparedAsk {
  const question = clean(input.question)
  const shape = loadShape(db)
  const point = askPoint(db, input.storyId, input.sceneId, shape)
  const turns = input.turns.filter((t) => clean(t.question) && clean(t.answer)).slice(-MAX_TURNS)
  const sel = selectEntries(db, point, question, turns)
  const storyStyle = point.story ? repo.getStory(db, point.story.id).style : {}
  const style = effectiveStyle(input.prefs, repo.getWorldStyle(db), storyStyle)

  const ids = (cs: Chosen[]): ID[] => cs.map((c) => c.entry.id)
  const sent = new Set([...ids(sel.named), ...ids(sel.cast), ...ids(sel.rules), ...ids(sel.related)])
  // What Adam keeps out here isn't named anywhere in what is sent, unless the question names it.
  const shown = withoutKeptOut(point, sel.keptOut)
  const conversation = [turns, turns.slice(-6), turns.slice(-3), turns.slice(-1)]
    .filter((t, i, all) => t.length && (i === 0 || t.length < all[i - 1].length))
    .map((t) => ({ text: conversationText(t).trim(), turns: t }))

  const blocks = [
    block('instructions', 1, 'How to answer', [askInstructions(style), askInstructions(style, true)]),
    block('where', 2, 'Where the author is', [whereText(db, point, shape)]),
    sel.named.length
      ? block(
          'named',
          3,
          namedTitle(sel.named),
          [
            sel.named.map((c) => profileText(shown, c, 0)).join('\n\n'),
            sel.named.map((c) => profileText(shown, c, 1)).join('\n\n'),
            sel.named.map((c) => lineOf(shown, c)).join('\n')
          ],
          ids(sel.named)
        )
      : null,
    block(
      'conversation',
      4,
      'The conversation so far',
      conversation.map((c) => c.text)
    ),
    point.sceneId
      ? block(
          'scene',
          5,
          'The open scene',
          [0, 1, 2].map((l) => sceneText(db, shown, sel.cast, l as 0 | 1 | 2)),
          ids(sel.cast)
        )
      : null,
    sel.rules.length
      ? block(
          'world-rules',
          6,
          'World rules (never break these)',
          [sel.rules.map((c) => profileText(shown, c, 0)).join('\n\n'), sel.rules.map((c) => lineOf(shown, c)).join('\n')],
          ids(sel.rules)
        )
      : null,
    sel.related.length
      ? block(
          'related',
          7,
          'Also relevant',
          [
            sel.related
              .map((c) =>
                [
                  formatProfile(c.entry, heading(c), c.entry.kind === 'character' ? ['basics', 'looks'] : undefined),
                  threadLine(shown, c.entry),
                  happenedText(c.entry, 3)
                ]
                  .filter(Boolean)
                  .join('\n\n')
              )
              .join('\n\n'),
            sel.related.map((c) => lineOf(shown, c)).join('\n')
          ],
          ids(sel.related)
        )
      : null,
    block(
      'story-so-far',
      8,
      'The story so far',
      Array.from({ length: STORY_LEVELS }, (_, i) => storyText(point, i))
    ),
    block('catalogue', 9, 'Everything else in the memory', [catalogueText(shown, sent, false), catalogueText(shown, sent, true)]),
    block('themes', 10, 'Themes and tone', [themesText(db, point, false), themesText(db, point, true)])
  ]
    .filter((b): b is BlockDraft => !!b)
    .sort((a, b) => ASK_ORDER.indexOf(a.id) - ASK_ORDER.indexOf(b.id))

  const versions = new Map<ID, string>()
  for (const id of sent) {
    const e = point.here.get(id) ?? point.later.get(id) ?? point.elsewhere.get(id)?.entry
    if (e) versions.set(id, e.updatedAt)
  }
  const targetWords = REPLY_WORDS
  return {
    prepared: {
      blocks,
      modes: {},
      // The question closes the messages, as a draft's closing instruction does.
      finals: { withPrevious: question, withoutPrevious: question },
      texts: [...blocks.flatMap((b) => formsOf(b).map((t) => blockAsSent(b, t))), question, question],
      contextLength: computeBudget(input.contextLength, targetWords).contextLength,
      targetWords,
      knows: point.knows,
      entries: []
    },
    question,
    conversation,
    versions,
    label: point.story ? point.label : 'The world as it was set up',
    storyId: point.story?.id ?? null,
    sceneId: point.sceneId
  }
}

/**
 * Fits the briefing to the model (`rawCounts`: plain token counts for `p.prepared.texts`, in order)
 * and builds the messages: the instructions and the briefing as the system message, then the earlier
 * turns that fit, then the question.
 */
export function finishAsk(p: PreparedAsk, rawCounts: number[]): AskBriefing {
  const preview = finishContext(p.prepared, rawCounts)
  const sent = preview.blocks.filter((b) => !b.dropped)
  const system = sent
    .filter((b) => b.id !== 'conversation')
    .map((b) => blockAsSent(b))
    .join('\n\n')
  const conv = sent.find((b) => b.id === 'conversation')
  const turns = conv ? (p.conversation.find((c) => c.text === conv.text)?.turns ?? []) : []
  const entries = sentEntryIds(preview.blocks).flatMap((id) => {
    const version = p.versions.get(id)
    return version ? [{ entryId: id, version }] : []
  })
  return {
    messages: askMessages(system, turns, p.question),
    blocks: preview.blocks,
    entries,
    budget: preview.budget,
    label: p.label,
    storyId: p.storyId,
    sceneId: p.sceneId,
    turnsSent: turns.length
  }
}

/** The whole briefing with a synchronous token counter (tests). */
export function assembleAsk(db: DB, input: AskContextInput, countRaw: (text: string) => number): AskBriefing {
  const p = prepareAsk(db, input)
  return finishAsk(p, p.prepared.texts.map(countRaw))
}
