// One scene's rows in the story index, built with no AI call from what the world already holds (overhaul phase 1):
// - who is there and who is only named: the scene card's point of view and people; anyone the words name as there (the
//   memory keeper's own rule, keeper/presence.ts namedIn: not only thought of, talked of or far away), by name, other
//   name, a first name no one else goes by, or what this scene's words call them (db/called.ts); whoever the memory saw
//   there (a knowledge change's `there`, who said something and who heard it); and whoever where things stand has values
//   for from this scene's own words. Places, things and the rest the words name are only named;
// - where and when: the card's place and When; the gist is the scene's summary;
// - dated facts from where things stand (continuity/tracker.ts): where each person is, each piece they have on, what they
//   carry and their condition, only where this scene changes it from the last scene before it that has one (so a fact
//   starts where it first became true, and a later scene's change stops it: storyIndex/link.ts);
// - dated facts from the memory's changes in the scene: what someone learns or forgets (never a wrong belief), a
//   relationship set or ended, a plot thread opened or closed, a death the memory is sure of (ai/deaths.ts surelyDied)
//   and any other note of what is now different, each stopped where the memory says it stops (its "true until");
// - plot thread events: the memory's thread changes, the card's "sets up" and "pays off", and a thread named in the words;
// - things left in the card's place, and taken or gone from it (place memory, storyIndex/placed.ts).
// Pure: the world is read by storyIndex/index.ts.

import type { Change, Entry, ID, SceneCard } from '@shared/types'
import { calledFor, findName, soleFirstName, type CalledName } from '@shared/names'
import { clothesOf, pieceSource, sourceKey, type CharacterState, type SceneState, type StateSource } from '@shared/continuity'
import { isAllClothes, isOff, itemKey, type StageItem } from '@shared/stageItems'
import { namedIn } from '../keeper/presence'
import { textParas } from '../keeper/text'
import { isPerson } from '../ai/mustStay'
import { deathRecord, surelyDied } from '../ai/deaths'
import type { IndexFactKind, IndexOrigin, NewIndexFact, NewThreadEvent } from './types'
import { placedFacts } from './placed'

/** The world's entries, read once for a build: names to look for, and who the stage's names are. */
export interface IndexWorld {
  entries: Map<ID, Entry>
  /** Each entry's names to look for: its name, other names and, for a person, a first name no one else goes by. */
  names: Map<ID, string[]>
  /** People (never an animal: ai/mustStay.ts isPerson). */
  people: Set<ID>
  /** A character's names in lower case, to the character: only names one character goes by (the stage's names). */
  byName: Map<string, ID>
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
/** A value as compared: case, spaces and a closing full stop don't matter. */
const compared = (s: string): string =>
  clean(s)
    .replace(/[.;,]+$/, '')
    .toLowerCase()
export const sameValue = (a: string, b: string): boolean => compared(a) === compared(b)
/** A text's words in lower case, split as names are (any apostrophe, a hyphen or a space between words). */
const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** The world's live entries (repo.listEntries), read for a build. */
export function indexWorld(live: readonly Entry[]): IndexWorld {
  const map = new Map(live.map((e) => [e.id, e]))
  const people = new Set(live.filter(isPerson).map((e) => e.id))
  const allNames = live.flatMap((e) =>
    [e.name, ...(e.aliases ?? [])]
      .map(clean)
      .filter(Boolean)
      .map((n) => ({ id: e.id, n }))
  )
  const names = new Map<ID, string[]>()
  for (const e of live) {
    const own = [...new Set([e.name, ...(e.aliases ?? [])].map(clean).filter((n) => n.length >= 2))]
    if (people.has(e.id)) {
      const first = soleFirstName(
        e.name,
        allNames.filter((x) => x.id !== e.id).map((x) => x.n)
      )
      if (first && !own.some((n) => n.toLowerCase() === first.toLowerCase())) own.push(first)
    }
    names.set(e.id, own)
  }
  // The stage names people as the cast list it was given (continuity/tracker.ts castFor): a name or another name.
  const byName = new Map<string, ID>()
  const shared = new Set<string>()
  for (const e of live) {
    if (e.kind !== 'character') continue
    for (const n of names.get(e.id) ?? []) {
      const k = n.toLowerCase()
      if (byName.has(k) && byName.get(k) !== e.id) shared.add(k)
      else byName.set(k, e.id)
    }
  }
  for (const k of shared) byName.delete(k)
  return { entries: map, names, people, byName }
}

/** Everything one scene's rows are built from. */
export interface SceneSource {
  sceneId: ID
  storyId: ID
  text: string
  card: SceneCard
  /** What this scene's words call its characters (db/called.ts). */
  called: CalledName[]
  /** The memory's changes pinned to this scene, as the writer is given them (a fact whose words were edited and not confirmed left out). */
  changes: Change[]
  /** The words each change was read from, by change id. */
  quotes: ReadonlyMap<ID, string>
  /** The scene's summary ('' for none). */
  summary: string
  /** Where things stand as the scene ends, read from its words as they are now (with Adam's Recall edits: `edited`); or null. */
  stage: { state: SceneState; edited: boolean } | null
  /** Where things stood at the end of the last scene before it in this story with such a state; null for none. */
  stageBefore: SceneState | null
  /**
   * The things in the place as the scene right before this one ended, with that scene's card place, when it has where
   * things stand (place memory, storyIndex/placed.ts: a thing gone from the place since). Null or left out: not known.
   */
  thingsBefore?: { placeId: ID | null; things: StageItem[] } | null
  /** True for a scene of this story: where a fact stops in another story's scene isn't kept. */
  inStory: (sceneId: ID) => boolean
}

/** One scene's rows, but for where it sits in its story and what it was built from. */
export interface SceneBuild {
  present: ID[]
  mentioned: ID[]
  placeEntryId: ID | null
  whenText: string
  gist: string
  facts: NewIndexFact[]
  threads: NewThreadEvent[]
}

export function buildScene(src: SceneSource, world: IndexWorld): SceneBuild {
  const facts: NewIndexFact[] = []
  const threads: NewThreadEvent[] = []
  const placeEntryId = src.card.locationId && world.entries.has(src.card.locationId) ? src.card.locationId : null
  const cast = [src.card.povId, ...(src.card.presentIds ?? [])].filter((id): id is ID => !!id && world.entries.has(id))
  const named = namedHere(src, world)
  const memory = memoryFacts(src, world, facts, threads)
  const staged = stageFacts(src, world, facts)
  // Place memory: the things left in the card's place, and those taken or gone (storyIndex/placed.ts).
  facts.push(...placedFacts(src, world))

  // The card's place is where its people are (a fact of its own, so a value read from the words isn't replaced by the
  // card's broader one while nothing moves).
  if (placeEntryId) {
    const place = clean(world.entries.get(placeEntryId)?.name)
    for (const id of new Set(cast))
      if (world.entries.get(id)?.kind === 'character') facts.push(fact(src, id, 'where', 'card', place, '', 'card'))
  }

  // Whoever where things stand has values for is there, unless the words name them only as thought of, talked of or far
  // away (2026-10-19: a stage read can list someone only remembered; they are named, not there).
  const onlyNamed = new Set(named.only)
  const present = [...new Set([...cast, ...named.there, ...memory.there, ...staged.filter((id) => !onlyNamed.has(id))])].filter(
    (id) => world.entries.has(id) && id !== placeEntryId
  )
  const here = new Set(present)
  const mentioned = [...named.only].filter((id) => !here.has(id) && id !== placeEntryId)

  // The card's "sets up" opens a thread and its "pays off" closes one; a thread the words name moves on here, unless the
  // scene opens or closes it.
  const card = (ids: readonly ID[] | undefined, event: 'opened' | 'closed'): void => {
    for (const id of ids ?? []) if (world.entries.get(id)?.kind === 'thread') threads.push({ threadEntryId: id, event, note: '' })
  }
  card(src.card.setsUpIds, 'opened')
  card(src.card.paysOffIds, 'closed')
  for (const id of [...named.there, ...named.only])
    if (world.entries.get(id)?.kind === 'thread' && !threads.some((t) => t.threadEntryId === id))
      threads.push({ threadEntryId: id, event: 'moved', note: '' })

  return {
    present,
    mentioned,
    placeEntryId,
    whenText: clean(src.card.when),
    gist: clean(src.summary),
    facts,
    threads: uniqueEvents(threads)
  }
}

const fact = (
  src: SceneSource,
  entryId: ID | null,
  kind: IndexFactKind,
  slot: string,
  value: string,
  quote: string,
  origin: IndexOrigin,
  from = src.sceneId
): NewIndexFact => ({
  entryId,
  kind,
  slot,
  value: clean(value),
  fromSceneId: from,
  quote: clean(quote),
  origin
})

/** One event of each kind for each thread: the first given (the memory's, with its note, come before the card's). */
function uniqueEvents(list: NewThreadEvent[]): NewThreadEvent[] {
  const out: NewThreadEvent[] = []
  for (const e of list) if (!out.some((x) => x.threadEntryId === e.threadEntryId && x.event === e.event)) out.push(e)
  return out
}

// ---------- Who the words name ----------

/** Who the scene's words name as there, and what they only name. */
function namedHere(src: SceneSource, world: IndexWorld): { there: ID[]; only: ID[] } {
  const there: ID[] = []
  const only: ID[] = []
  if (!src.text.trim()) return { there, only }
  const words = new Set(wordsOf(src.text))
  const paras = textParas(src.text)
  for (const [id, e] of world.entries) {
    // A quick look first: every word of the name somewhere in the scene.
    const names = [...(world.names.get(id) ?? []), ...calledFor(src.called, id)].filter((n) => {
      const ws = wordsOf(n)
      return ws.length > 0 && ws.every((w) => words.has(w))
    })
    if (!names.length) continue
    const hits = paras.filter((p) => names.some((n) => findName(p.text, n)))
    if (!hits.length) continue
    if (!world.people.has(id)) {
      only.push(id)
      continue
    }
    const person = { ...e, aliases: names.filter((n) => n !== e.name) }
    if (hits.some((p) => namedIn(p.text, person) === 'there')) there.push(id)
    else only.push(id)
  }
  return { there, only }
}

// ---------- Where things stand ----------

const STAGE_FIELDS = [
  ['where', 'where'],
  ['holding', 'carrying'],
  ['condition', 'condition']
] as const satisfies readonly (readonly [keyof CharacterState, IndexFactKind])[]

/** A piece someone has on, as a fact says it: "grey coat", "white shirt (unbuttoned to the waist)". */
function wornText(name: string, state: string): string {
  const how = clean(state)
    .replace(/^on\b[\s,;:–—-]*/i, '')
    .trim()
  return how ? `${clean(name)} (${how})` : clean(name)
}

/** The pieces someone has on, by the piece's name as compared (itemKey). */
function worn(c: CharacterState | undefined): Map<string, { name: string; text: string }> {
  const out = new Map<string, { name: string; text: string }>()
  for (const p of clothesOf(c)) {
    const name = clean(p.name)
    if (!name || isOff(p.state) || isAllClothes(name) || (!clean(p.state) && /\boff\b/i.test(name))) continue
    out.set(itemKey(name), { name, text: wornText(name, p.state) })
  }
  return out
}

/**
 * Facts from where things stand: each value this scene changes from where things stood before it (the last scene of the
 * story with a state read from its words as they are now), only where this scene's own words gave the new value (its
 * `said`), or Adam set it in Recall, or the state is from before values kept their words. So a value carried on from a
 * scene before, in a state built on that scene's older reading, never starts a fact here (no ghosts). A value gone, or a
 * piece taken off, stops its fact here. Who the stage has values for from this scene's own words is there.
 */
function stageFacts(src: SceneSource, world: IndexWorld, out: NewIndexFact[]): ID[] {
  if (!src.stage) return []
  const { state, edited } = src.stage
  const calledHere = new Map(src.called.map((c) => [clean(c.words).toLowerCase(), c.entryId]))
  const idOf = (name: string): ID | undefined => world.byName.get(clean(name).toLowerCase()) ?? calledHere.get(clean(name).toLowerCase())
  const before = new Map<ID, CharacterState>()
  for (const c of src.stageBefore?.characters ?? []) {
    const id = idOf(c.name)
    if (id && !before.has(id)) before.set(id, c)
  }
  /** Whose a new value is: the stage's (with its words), Adam's, or no one's here (null: carried from elsewhere). */
  const whose = (said: StateSource | undefined): { origin: IndexOrigin; quote: string } | null => {
    if (said?.sceneId === src.sceneId) return { origin: 'tracker', quote: said.line ? '' : said.quote }
    if (said) return null
    if (edited) return { origin: 'hand', quote: '' }
    return state.said ? null : { origin: 'tracker', quote: '' }
  }
  const ends: IndexOrigin = edited ? 'hand' : 'tracker'
  const there: ID[] = []
  const seen = new Set<ID>()
  for (const c of state.characters) {
    const id = idOf(c.name)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const prev = before.get(id)
    if (Object.entries(state.said ?? {}).some(([k, v]) => v.sceneId === src.sceneId && k.startsWith(`${c.name.toLowerCase()}|`)))
      there.push(id)
    for (const [field, kind] of STAGE_FIELDS) {
      const now = clean(c[field])
      if (sameValue(now, clean(prev?.[field]))) continue
      if (!now) {
        out.push(fact(src, id, kind, '', '', '', ends))
        continue
      }
      const by = whose(state.said?.[sourceKey(c.name, field)])
      if (by) out.push(fact(src, id, kind, '', now, by.quote, by.origin))
    }
    const on = worn(c)
    const was = worn(prev)
    for (const [key, p] of on) {
      if (sameValue(p.text, was.get(key)?.text ?? '')) continue
      const by = whose(pieceSource(state.said, c.name, p.name, on.size))
      if (by) out.push(fact(src, id, 'wearing', key, p.text, by.quote, by.origin))
    }
    // Taken off here: a piece on before and listed as off now, or one this scene's words say is off (it may have been put
    // on in a scene whose stage has gone since). A piece no longer listed at all may only have made room for newer ones.
    for (const p of clothesOf(c)) {
      const key = itemKey(clean(p.name))
      if (on.has(key) || !key) continue
      const said = pieceSource(state.said, c.name, p.name, 1)
      if (was.has(key) || said?.sceneId === src.sceneId) out.push(fact(src, id, 'wearing', key, '', '', ends))
    }
  }
  return there
}

// ---------- The memory's changes ----------

/** A note that undoes a death ("survived", "alive after all"): the memory's own rule (ai/deaths.ts deathRecord). */
const saysAlive = (note: string): boolean =>
  deathRecord({
    kind: 'character',
    happened: [
      { note: 'died', where: '', changeId: '' },
      { note, where: '', changeId: '' }
    ]
  }) === null

/** A relationship in words, from the change's side: "sister; Mara feels wary; Tobin feels fond". */
function relationWords(world: IndexWorld, entryId: ID, otherId: ID, p: { type?: string; feels?: string; otherFeels?: string }): string {
  const me = clean(world.entries.get(entryId)?.name)
  const other = clean(world.entries.get(otherId)?.name)
  return [clean(p.type), clean(p.feels) && `${me} feels ${clean(p.feels)}`, clean(p.otherFeels) && `${other} feels ${clean(p.otherFeels)}`]
    .filter(Boolean)
    .join('; ')
}

/** Facts and thread events from the memory's changes in the scene; who the memory saw there. */
function memoryFacts(src: SceneSource, world: IndexWorld, facts: NewIndexFact[], threads: NewThreadEvent[]): { there: ID[] } {
  const there = new Set<ID>()
  for (const c of src.changes) {
    if (!world.entries.has(c.entryId)) continue
    const quote = src.quotes.get(c.id) ?? ''
    const origin: IndexOrigin = c.origin === 'adam' ? 'hand' : 'memory'
    const add = (kind: IndexFactKind, slot: string, value: string, entryId: ID = c.entryId): void => {
      facts.push(fact(src, entryId, kind, slot, value, value ? quote : '', origin))
    }
    // Where the memory says it stops being true ("true until"), when that is a later scene of this story.
    const until = (kind: IndexFactKind, slot: string, entryId: ID = c.entryId): void => {
      const u = c.until
      if (!u || u.sceneId === src.sceneId || !src.inStory(u.sceneId)) return
      facts.push(fact(src, entryId, kind, slot, '', u.quote, u.origin === 'adam' ? 'hand' : 'memory', u.sceneId))
    }
    switch (c.kind) {
      case 'knowledge': {
        const p = c.payload
        for (const id of [...(p.there ?? []), ...(p.said ? [p.said.by, ...(p.said.heard ?? [])] : [])]) if (id) there.add(id)
        // Something believed that isn't true is never known (long story memory fix 9).
        if (!p.factId || !clean(p.fact) || p.wrong) break
        if (p.forgets) add('knows', p.factId, '')
        else {
          add('knows', p.factId, p.fact)
          until('knows', p.factId)
        }
        break
      }
      case 'relationship': {
        const p = c.payload
        if (!p.otherId || !world.entries.has(p.otherId)) break
        const slot = `with:${p.otherId}`
        if (p.ended) add('relationship', slot, '')
        else {
          add('relationship', slot, relationWords(world, c.entryId, p.otherId, p) || 'related')
          until('relationship', slot)
        }
        break
      }
      case 'thread': {
        const p = c.payload
        if (p.status === 'resolved') {
          add('thread', '', '')
          threads.push({ threadEntryId: c.entryId, event: 'closed', note: clean(p.note) })
        } else {
          add('thread', '', clean(p.note) || 'open')
          until('thread', '')
          threads.push({ threadEntryId: c.entryId, event: 'opened', note: clean(p.note) })
        }
        break
      }
      case 'update': {
        const note = clean(c.payload.note)
        if (!note) break
        const kind = world.entries.get(c.entryId)?.kind
        if (kind === 'thread') threads.push({ threadEntryId: c.entryId, event: 'moved', note })
        if (kind === 'character' && surelyDied(note)) {
          add('status', 'life', 'dead')
          until('status', 'life')
        } else if (kind === 'character' && saysAlive(note)) add('status', 'life', '')
        else {
          add('status', `note:${c.id}`, note)
          until('status', `note:${c.id}`)
        }
        break
      }
      // A full description is only ever made at a story's start, never in a scene.
      case 'full':
        break
    }
  }
  return { there: [...there] }
}
