// Looking things up in the story index (overhaul phase 1): plain database reads over the rows storyIndex/index.ts keeps,
// each a query or two however long the story. Each gives plain data and the same in short plain-English lines for a
// prompt ("Mara: wearing grey coat (since Ch 3, Sc 2)"). A point in the story is a scene of the story: what is true as it
// ends (its own facts counted), or with `asItBegins`, as it begins. Nothing is worked out with the AI. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as sidx from '../db/storyIndex'
import { storyCalendar } from '../memory/storyCalendar'
import { dateLabel } from '../memory/calendar'
import { sameFact, words } from '../keeper/text'
import { chainKey } from './link'
import type { IndexFactKind, IndexOrigin, IndexScene, PlacedFact } from './types'

type DB = Database.Database

/** A fact true at the point asked about: its value, the scene it has been true since, and the words that show it. */
export interface FactNow {
  value: string
  /** Where it became true, in plain words ("Ch 3, Sc 2"). */
  since: string
  sinceSceneId: ID
  quote: string
  origin: IndexOrigin
}

export interface AtOptions {
  /** As the scene begins (before its own facts), rather than as it ends. */
  asItBegins?: boolean
}

/** The story's scene row for a point, and the cut it makes: facts started at or before it, and not stopped by it. */
function pointOf(db: DB, storyId: ID, sceneId: ID, opts: AtOptions = {}): { scene: IndexScene; cut: number } | null {
  const scene = sidx.indexScene(db, sceneId)
  if (!scene || scene.storyId !== storyId) return null
  return { scene, cut: opts.asItBegins ? scene.position - 1 : scene.position }
}

/**
 * The facts true at a cut, one for each thing they are about (each chain: link.ts), with the scene each has been true
 * since: where its run of the same value began.
 */
function current(rows: readonly PlacedFact[]): Current[] {
  const runs = new Map<string, PlacedFact[]>()
  for (const r of rows) {
    const key = chainKey(r)
    const list = runs.get(key)
    if (list) list.push(r)
    else runs.set(key, [r])
  }
  return [...runs.values()].map((list) => {
    const last = list[list.length - 1]
    const first = list[0]
    return {
      value: last.value,
      since: first.fromLabel,
      sinceSceneId: first.fromSceneId,
      quote: list.map((r) => r.quote).find(Boolean) ?? '',
      origin: first.origin,
      fact: last,
      start: first.fromPosition
    }
  })
}

/** A fact true at a cut, with its latest row and where its run began. */
type Current = FactNow & { fact: PlacedFact; start: number }

const strip = ({ fact: _fact, start: _start, ...rest }: Current): FactNow => rest
const sinceWords = (f: Pick<FactNow, 'value' | 'since'>): string => `${f.value} (since ${f.since})`
/** Where someone is, as a line says it: the stage's own words ("by the hearth"), or "at" a place's name ("at The Swan"). */
const whereWords = (v: string): string =>
  /^(?:at|in|on|by|near|inside|outside|under|behind|beside|with|across|through|between|among|aboard|atop|upstairs|downstairs|over|against|before|around)\b/i.test(
    v
  )
    ? v
    : `at ${v}`

// ---------- What is true of one character ----------

export interface EntryNow {
  entryId: ID
  name: string
  /** The point asked about. */
  sceneId: ID
  label: string
  /** Where they are: from the story's words, or the card's place when that is newer; else where they were last seen. */
  place: (FactNow & { lastSeen?: true }) | null
  wearing: (FactNow & { piece: string })[]
  carrying: FactNow | null
  condition: FactNow | null
  knows: (FactNow & { factId: ID })[]
  relationships: (FactNow & { withId: ID; withName: string })[]
  /** What else the memory has as now different ("lost her knife"). */
  status: FactNow[]
  /** Since when they are dead, when the memory is sure they died. */
  dead: FactNow | null
  lines: string[]
}

/**
 * What is true of an entry (by id, name or other name) at a point of a story: where they are, what they have on, carry
 * and suffer, what they know, their relationships and what else has changed. Null when the entry or the point isn't
 * known.
 */
export function stateOf(db: DB, storyId: ID, entryIdOrName: string, atSceneId: ID, opts: AtOptions = {}): EntryNow | null {
  const entry = sidx.findIndexEntry(db, entryIdOrName)
  const at = pointOf(db, storyId, atSceneId, opts)
  if (!entry || !at) return null
  const facts = current(sidx.factsAt(db, storyId, at.cut, { entryId: entry.id }))
  const own = (kind: IndexFactKind, slot?: string): Current[] =>
    facts.filter((f) => f.fact.kind === kind && f.fact.entryId === entry.id && (slot === undefined || f.fact.slot === slot))
  const one = (kind: IndexFactKind): FactNow | null => {
    const f = own(kind, '')[0]
    return f ? strip(f) : null
  }

  // The story's words say more than the card's place, so they win unless the card moved them on since.
  const fromWords = own('where', '')[0]
  const fromCard = own('where', 'card')[0]
  const latest = fromCard && (!fromWords || fromCard.start > fromWords.start) ? fromCard : fromWords
  let place: EntryNow['place'] = latest ? strip(latest) : null
  if (!place) {
    const seen = sidx.lastPresentBefore(db, storyId, entry.id, at.cut + 1)
    const where = seen?.placeEntryId ? sidx.entryNames(db, [seen.placeEntryId]).get(seen.placeEntryId)?.name : undefined
    if (seen && where) place = { value: where, since: seen.label, sinceSceneId: seen.sceneId, quote: '', origin: 'card', lastSeen: true }
  }
  const others = sidx.entryNames(
    db,
    facts
      .filter((f) => f.fact.kind === 'relationship')
      .map((f) => (f.fact.entryId === entry.id ? f.fact.slot.slice(5) : (f.fact.entryId ?? '')))
  )
  const relationships = facts
    .filter((f) => f.fact.kind === 'relationship')
    .map((f) => {
      const withId = f.fact.entryId === entry.id ? f.fact.slot.slice(5) : (f.fact.entryId ?? '')
      return { ...strip(f), withId, withName: others.get(withId)?.name ?? '' }
    })
    .filter((r) => r.withName)
  const life = own('status', 'life')[0]
  const now: EntryNow = {
    entryId: entry.id,
    name: entry.name,
    sceneId: atSceneId,
    label: at.scene.label,
    place,
    wearing: own('wearing').map((f) => ({ ...strip(f), piece: f.fact.slot })),
    carrying: one('carrying'),
    condition: one('condition'),
    knows: own('knows').map((f) => ({ ...strip(f), factId: f.fact.slot })),
    relationships,
    status: own('status')
      .filter((f) => f.fact.slot !== 'life')
      .map(strip),
    dead: life ? strip(life) : null,
    lines: []
  }
  const n = entry.name
  if (now.dead) now.lines.push(`${n}: dead (since ${now.dead.since})`)
  if (place)
    now.lines.push(
      place.lastSeen ? `${n}: last seen at ${place.value} (${place.since})` : `${n}: ${whereWords(place.value)} (since ${place.since})`
    )
  if (now.wearing.length) now.lines.push(`${n}: wearing ${now.wearing.map(sinceWords).join('; ')}`)
  if (now.carrying) now.lines.push(`${n}: carrying ${sinceWords(now.carrying)}`)
  if (now.condition) now.lines.push(`${n}: ${sinceWords(now.condition)}`)
  for (const s of now.status) now.lines.push(`${n}: ${sinceWords(s)}`)
  for (const r of now.relationships) now.lines.push(`${n} and ${r.withName}: ${sinceWords(r)}`)
  for (const k of now.knows) now.lines.push(`${n} knows: ${sinceWords(k)}`)
  return now
}

// ---------- Where someone was last ----------

export interface LastSeen {
  entryId: ID
  name: string
  sceneId: ID
  label: string
  gist: string
  line: string
}

/** The last scene before this one in the story with someone there, with what happens in it; null when there is none. */
export function lastSeen(db: DB, storyId: ID, entryIdOrName: string, beforeSceneId: ID): LastSeen | null {
  const entry = sidx.findIndexEntry(db, entryIdOrName)
  const at = pointOf(db, storyId, beforeSceneId)
  if (!entry || !at) return null
  const seen = sidx.lastPresentBefore(db, storyId, entry.id, at.scene.position)
  if (!seen) return null
  const place = seen.placeEntryId ? sidx.entryNames(db, [seen.placeEntryId]).get(seen.placeEntryId)?.name : undefined
  return {
    entryId: entry.id,
    name: entry.name,
    sceneId: seen.sceneId,
    label: seen.label,
    gist: seen.gist,
    line: `${entry.name} was last there in ${seen.label}${place ? `, at ${place}` : ''}${seen.gist ? `: ${seen.gist}` : '.'}`
  }
}

// ---------- Who knows what ----------

export interface Knower {
  entryId: ID
  name: string
  since: string
  sinceSceneId: ID
}

export interface WhoKnows {
  facts: { factId: ID; fact: string; knownBy: Knower[] }[]
  lines: string[]
}

/** Little words that never say what a thread is about. */
const LITTLE = new Set('a an the of to in on at for and or with by from his her their its who what why how'.split(' '))

/**
 * Who knows a fact at a point: the facts known there that say what `factOrThread` says (its words all in the fact, or
 * the fact's in it: keeper/text.ts sameFact), or, for a plot thread (its id or name), that name it or its main word (the
 * last word that matters: "seal" of "The stolen seal"). Each with who knows it and since when. Never a belief that isn't
 * true (the index doesn't keep them as known).
 */
export function whoKnows(db: DB, storyId: ID, factOrThread: string, atSceneId: ID, opts: AtOptions = {}): WhoKnows {
  const none: WhoKnows = { facts: [], lines: [] }
  const at = pointOf(db, storyId, atSceneId, opts)
  const asked = factOrThread.replace(/\s+/g, ' ').trim()
  if (!at || !asked) return none
  const thread = sidx.findIndexEntry(db, asked)
  const term = thread?.kind === 'thread' ? thread.name : asked
  const main =
    thread?.kind === 'thread'
      ? (words(term)
          .filter((w) => w.length >= 3 && !LITTLE.has(w))
          .at(-1) ?? '')
      : ''
  const known = current(sidx.factsAt(db, storyId, at.cut, { kinds: ['knows'] })).filter(
    (f) => sameFact(f.value, term) || (!!main && words(f.value).includes(main))
  )
  const names = sidx.entryNames(
    db,
    known.map((f) => f.fact.entryId ?? '')
  )
  const byFact = new Map<ID, { factId: ID; fact: string; knownBy: Knower[] }>()
  for (const f of known) {
    const name = names.get(f.fact.entryId ?? '')?.name
    if (!name || !f.fact.entryId) continue
    const item = byFact.get(f.fact.slot) ?? { factId: f.fact.slot, fact: f.value, knownBy: [] }
    item.fact = f.value
    item.knownBy.push({ entryId: f.fact.entryId, name, since: f.since, sinceSceneId: f.sinceSceneId })
    byFact.set(f.fact.slot, item)
  }
  const facts = [...byFact.values()]
  return {
    facts,
    lines: facts.map((f) => `${f.fact}: known by ${f.knownBy.map((k) => `${k.name} (since ${k.since})`).join(', ')}`)
  }
}

// ---------- Open plot threads ----------

export interface OpenThread {
  threadId: ID
  name: string
  /** Where it was first opened or touched in this story. */
  since: string
  sinceSceneId: ID
  /** Where something last happened to it. */
  lastTouched: string
  lastSceneId: ID
  /** How many scenes it has been quiet since, up to the point asked about. */
  quietScenes: number
  /** The memory's latest note on it, '' for none. */
  note: string
}

/**
 * The plot threads open at a point: opened (by the memory or the card's "sets up") or touched in the story so far and not
 * closed since (by the memory or the card's "pays off"), longest open first.
 */
export function openThreads(db: DB, storyId: ID, atSceneId: ID, opts: AtOptions = {}): { threads: OpenThread[]; lines: string[] } {
  const at = pointOf(db, storyId, atSceneId, opts)
  if (!at) return { threads: [], lines: [] }
  const state = new Map<
    ID,
    { open: boolean; since: { label: string; id: ID } | null; last: { label: string; id: ID; position: number }; note: string }
  >()
  for (const e of sidx.threadEventsUpTo(db, storyId, at.cut)) {
    const s = state.get(e.threadEntryId) ?? {
      open: false,
      since: null,
      last: { label: e.label, id: e.sceneId, position: e.position },
      note: ''
    }
    if (e.event === 'closed') {
      s.open = false
      s.since = null
    } else {
      if (!s.open) s.since = { label: e.label, id: e.sceneId }
      s.open = true
    }
    s.last = { label: e.label, id: e.sceneId, position: e.position }
    if (e.note) s.note = e.note
    state.set(e.threadEntryId, s)
  }
  const notes = new Map(current(sidx.factsAt(db, storyId, at.cut, { kinds: ['thread'] })).map((f) => [f.fact.entryId ?? '', f.value]))
  const names = sidx.entryNames(db, [...state.keys()])
  const threads: OpenThread[] = []
  for (const [id, s] of state) {
    const name = names.get(id)?.name
    if (!s.open || !s.since || !name) continue
    const note = notes.get(id) ?? s.note
    threads.push({
      threadId: id,
      name,
      since: s.since.label,
      sinceSceneId: s.since.id,
      lastTouched: s.last.label,
      lastSceneId: s.last.id,
      quietScenes: Math.max(0, at.cut - s.last.position),
      note: note === 'open' ? '' : note
    })
  }
  const order = new Map(sidx.indexScenes(db, storyId).map((s) => [s.sceneId, s.position]))
  threads.sort((a, b) => (order.get(a.sinceSceneId) ?? 0) - (order.get(b.sinceSceneId) ?? 0) || a.name.localeCompare(b.name))
  return {
    threads,
    lines: threads.map(
      (t) =>
        `${t.name} (open since ${t.since}${t.lastTouched !== t.since ? `, last touched ${t.lastTouched}` : ''}${t.quietScenes ? `, quiet for ${t.quietScenes} ${t.quietScenes === 1 ? 'scene' : 'scenes'}` : ''})${t.note ? `: ${t.note}` : ''}`
    )
  }
}

// ---------- Scenes ----------

/** What happens in each scene from one to another of the same story (both included), in story order. */
export function sceneGists(
  db: DB,
  storyId: ID,
  fromSceneId: ID,
  toSceneId: ID
): { scenes: { sceneId: ID; label: string; gist: string }[]; lines: string[] } {
  const from = pointOf(db, storyId, fromSceneId)
  const to = pointOf(db, storyId, toSceneId)
  if (!from || !to) return { scenes: [], lines: [] }
  const rows = sidx.indexScenesBetween(
    db,
    storyId,
    Math.min(from.scene.position, to.scene.position),
    Math.max(from.scene.position, to.scene.position)
  )
  const scenes = rows.map((s) => ({ sceneId: s.sceneId, label: s.label, gist: s.gist }))
  return { scenes, lines: scenes.filter((s) => s.gist).map((s) => `${s.label}: ${s.gist}`) }
}

export interface PresentAt {
  sceneId: ID
  label: string
  present: { id: ID; name: string }[]
  mentioned: { id: ID; name: string }[]
  place: { id: ID; name: string } | null
  when: string
  lines: string[]
}

/** Who is in a scene, who is only named, its place and its When; null when it isn't in the index. */
export function presentAt(db: DB, sceneId: ID): PresentAt | null {
  const s = sidx.indexScene(db, sceneId)
  if (!s) return null
  const names = sidx.entryNames(db, [...s.present, ...s.mentioned, ...(s.placeEntryId ? [s.placeEntryId] : [])])
  const named = (ids: readonly ID[]): { id: ID; name: string }[] =>
    ids.flatMap((id) => {
      const n = names.get(id)?.name
      return n ? [{ id, name: n }] : []
    })
  const present = named(s.present)
  const mentioned = named(s.mentioned)
  const place = s.placeEntryId && names.get(s.placeEntryId) ? { id: s.placeEntryId, name: names.get(s.placeEntryId)!.name } : null
  const head = `${s.label}${place ? ` at ${place.name}` : ''}${s.whenText ? `, ${s.whenText}` : ''}`
  return {
    sceneId,
    label: s.label,
    present,
    mentioned,
    place,
    when: s.whenText,
    lines: [
      head,
      ...(present.length ? [`There: ${present.map((p) => p.name).join(', ')}`] : []),
      ...(mentioned.length ? [`Named: ${mentioned.map((p) => p.name).join(', ')}`] : [])
    ]
  }
}

export interface TimelineScene {
  sceneId: ID
  label: string
  /** The card's When, as Adam wrote it. */
  when: string
  /** The day and time the story calendar works out for it ("Day 4 · evening"), '' when it can't tell. */
  date: string
}

/** Each scene's in-world date, up to a scene of the story (or all of it), in story order. */
export function timeline(db: DB, storyId: ID, upToSceneId?: ID): { scenes: TimelineScene[]; lines: string[] } {
  const to = upToSceneId ? pointOf(db, storyId, upToSceneId) : null
  if (upToSceneId && !to) return { scenes: [], lines: [] }
  const rows = sidx.indexScenesBetween(db, storyId, 1, to ? to.scene.position : Number.MAX_SAFE_INTEGER)
  let dates: Map<ID, Parameters<typeof dateLabel>[0]> | null = null
  try {
    dates = storyCalendar(db, storyId)?.dates ?? null
  } catch (e) {
    console.warn('Could not read the story calendar for the story index', e)
  }
  const scenes = rows.map((s) => ({ sceneId: s.sceneId, label: s.label, when: s.whenText, date: dateLabel(dates?.get(s.sceneId)) }))
  return {
    scenes,
    lines: scenes
      .filter((s) => s.when || s.date)
      .map(
        (s) =>
          `${s.label}: ${s.date && s.date.toLowerCase() !== s.when.toLowerCase() ? `${s.date}${s.when ? ` (“${s.when}”)` : ''}` : s.when}`
      )
  }
}
