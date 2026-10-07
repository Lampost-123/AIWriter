// Where things stand (Adam, 2026-10-04): what the continuity tracker keeps for each character as a scene ends, and
// for the scene (src/main/continuity/tracker.ts), in plain data, with how it reads and how a scene's changes are
// laid over the state before. Changes, not guesses (Adam, 2026-10-07): every value the memory model gives comes with
// the words that show it, and one whose words aren't in the text is left out. Piece by piece (step 2b, Adam
// 2026-10-07): each piece of clothing someone has on or took off is its own entry with its own words, and so is each
// thing in the place (a door barred, a case on the windowsill), and who touches whom and who can see or hear whom are
// kept as the words say them (shared/stageItems.ts). A state kept before step 2b, with all that was worn in one line,
// is read as pieces with nothing lost (clothesOf). Shared by the main process and the Recall panel. Pure.

import {
  isGone,
  isOff,
  itemKey,
  itemsFromText,
  mergeItems,
  MOST_CLOTHES,
  MOST_THINGS,
  pieceText,
  readItem,
  thingText,
  type StageItem
} from './stageItems'

export type { StageItem } from './stageItems'

/** One character as a scene ends. '' where the story hasn't said. */
export interface CharacterState {
  name: string
  where: string
  posture: string
  holding: string
  condition: string
  mood: string
  lastAction: string
  /** Who they are touching and how, only as the words say it (step 2b; not in states kept before it). */
  touching?: string
  /** Who they can or can't see or hear, only as the words say it (step 2b; not in states kept before it). */
  sees?: string
  /** Each piece of clothing they have on or took off, with how it is now (step 2b). States kept before it have `wearing`. */
  clothes?: StageItem[]
  /** Before step 2b: all they wore, in one line. Read as pieces (clothesOf); never written now. */
  wearing?: string
}

export interface SceneState {
  time: string
  weather: string
  light: string
  /**
   * The things in the place that matter, each with where and how it is now (step 2b): only what the words put there. Not
   * in states kept before it.
   */
  things?: StageItem[]
  characters: CharacterState[]
  /** The words behind each value, by sourceKey; a value carried on from before keeps its words. */
  said?: StateSources
}

/** The words a value came from, copied from the story, and the scene they are in. */
export interface StateSource {
  quote: string
  sceneId: string
}
export type StateSources = Record<string, StateSource>
/** Where a value's words are kept: the character's name (lower case) and the field, or '' and the scene's field. */
export const sourceKey = (character: string | null, field: string): string => `${character ? character.toLowerCase() : ''}|${field}`

/** The values kept for each character in a line of their own; what they wear is kept piece by piece (`clothes`). */
export const STATE_FIELDS = ['where', 'posture', 'touching', 'sees', 'holding', 'condition', 'mood', 'lastAction'] as const
/** One of the values kept for each character. */
export type StateField = (typeof STATE_FIELDS)[number]
/** Words for each field, as the writer and Adam read them. */
export const STATE_LABELS: Record<(typeof STATE_FIELDS)[number], string> = {
  where: 'where',
  posture: 'position',
  touching: 'touching',
  sees: 'sees or hears',
  holding: 'holding',
  condition: 'condition',
  mood: 'mood',
  lastAction: 'last did'
}
/** The most characters kept. */
export const MOST_TRACKED = 40
/** The longest a value is kept: room for a full description of a pose. */
export const LONGEST_VALUE = 400
const clip = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, LONGEST_VALUE) : '')
const empty = (): SceneState => ({ time: '', weather: '', light: '', things: [], characters: [] })
/** A character with nothing known yet. */
const blankCharacter = (name: string): CharacterState => ({
  name,
  ...(Object.fromEntries(STATE_FIELDS.map((f) => [f, ''])) as Record<StateField, string>),
  clothes: []
})

// ---------- Piece by piece ----------

/** Where the words of one piece of someone's clothing are kept. */
export const pieceKey = (character: string, item: string): string => sourceKey(character, `clothes:${itemKey(item)}`)
/** Where the words of one thing in the place are kept. */
export const thingKey = (thing: string): string => sourceKey(null, `thing:${itemKey(thing)}`)

/**
 * What someone wears, piece by piece: as kept, or, in a state kept before step 2b, their one line read as pieces
 * (itemsFromText), with nothing lost.
 */
export function clothesOf(c: Pick<CharacterState, 'clothes' | 'wearing'> | null | undefined): StageItem[] {
  if (!c) return []
  return c.clothes ?? itemsFromText(c.wearing ?? '')
}

/** The things in the place; none in a state kept before step 2b. */
export const thingsOf = (s: Pick<SceneState, 'things'> | null | undefined): StageItem[] => s?.things ?? []

/** The words behind one piece of someone's clothing: its own, or, read from an old one-line "wearing", that line's. */
export function pieceSource(said: StateSources | undefined, character: string, item: string): StateSource | undefined {
  return said?.[pieceKey(character, item)] ?? said?.[sourceKey(character, 'wearing')]
}

/** A character as step 2b keeps them: what they wear piece by piece, the words of an old one-line "wearing" on each piece. */
function asPieces(c: CharacterState, said: StateSources): CharacterState {
  if (c.clothes) return c
  const { wearing, ...rest } = c
  const clothes = itemsFromText(wearing ?? '')
  const old = said[sourceKey(c.name, 'wearing')]
  if (old) for (const p of clothes) said[pieceKey(c.name, p.name)] ??= old
  delete said[sourceKey(c.name, 'wearing')]
  return { ...rest, clothes }
}

/** A list with Adam's changes laid over it, each by the name of the piece or thing it was (null: taken out; new: added). */
function itemEdits(list: StageItem[], edits: Record<string, StageItem | null>, forget: (name: string) => void): StageItem[] {
  let out = list.map((x) => ({ ...x }))
  for (const [key, now] of Object.entries(edits)) {
    const at = out.findIndex((x) => itemKey(x.name) === key)
    if (at >= 0) forget(out[at].name)
    if (now) forget(now.name)
    if (at >= 0 && now) out[at] = { ...now }
    else if (at >= 0) out = out.filter((_, i) => i !== at)
    else if (now) out.push({ ...now })
  }
  return out
}

/** Adam's own changes to one character: values, and pieces of clothing by the name of the piece they were. */
export type CharacterEdits = Partial<Record<StateField | 'name' | 'wearing', string>> & {
  /** By the piece's name as compared (itemKey): its new name and state, or null when he took it out. */
  clothes?: Record<string, StageItem | null>
}

/** Adam's own changes to a scene's state: values by character (name, lower case) or for the scene, and who he took out. */
export interface StateEdits {
  scene?: Partial<Record<'time' | 'weather' | 'light', string>>
  characters?: Record<string, CharacterEdits>
  /** The things in the place, by the thing's name as compared (itemKey): its new name and state, or null when taken out. */
  things?: Record<string, StageItem | null>
  removed?: string[]
}

/**
 * A kept state with Adam's edits laid over it. A state kept before step 2b, with only the edits made then, comes back
 * exactly as it was laid over then (the scenes after it are checked against its hash).
 */
export function withEdits(state: SceneState, edits: StateEdits | undefined): SceneState {
  if (!edits) return state
  const out: SceneState = { ...state, ...(edits.scene ?? {}), characters: state.characters.map((c) => ({ ...c })) }
  // A value Adam set is his own, not the words'.
  const said: StateSources = { ...(state.said ?? {}) }
  for (const f of Object.keys(edits.scene ?? {})) delete said[sourceKey(null, f)]
  const removed = new Set((edits.removed ?? []).map((n) => n.toLowerCase()))
  out.characters = out.characters.filter((c) => !removed.has(c.name.toLowerCase()))
  for (const [name, values] of Object.entries(edits.characters ?? {})) {
    if (removed.has(name)) continue
    let at = out.characters.findIndex((x) => x.name.toLowerCase() === name)
    if (at < 0) at = out.characters.push(blankCharacter(values.name ?? name)) - 1
    let c = out.characters[at]
    for (const f of STATE_FIELDS)
      if (values[f] !== undefined) {
        c[f] = (values[f] ?? '').slice(0, LONGEST_VALUE)
        delete said[sourceKey(c.name, f)]
      }
    // An edit made before step 2b: all they wore, in one line.
    if (values.wearing !== undefined) {
      const line = (values.wearing ?? '').slice(0, LONGEST_VALUE)
      if (c.clothes) {
        for (const p of c.clothes) delete said[pieceKey(c.name, p.name)]
        c.clothes = itemsFromText(line)
      } else c.wearing = line
      delete said[sourceKey(c.name, 'wearing')]
    }
    if (values.clothes) {
      c = out.characters[at] = asPieces(c, said)
      const who = c.name
      c.clothes = itemEdits(c.clothes!, values.clothes, (p) => delete said[pieceKey(who, p)])
    }
  }
  if (edits.things) out.things = itemEdits(thingsOf(out), edits.things, (t) => delete said[thingKey(t)])
  if (state.said) out.said = keepSaid(said, out)
  return out
}

/** Only the words behind values still there: a piece of clothing or a thing whose words they are must still be there. */
function keepSaid(said: StateSources, state: SceneState): StateSources {
  const people = new Map(state.characters.map((c) => [c.name.toLowerCase(), c]))
  const things = new Set(thingsOf(state).map((t) => itemKey(t.name)))
  return Object.fromEntries(
    Object.entries(said).filter(([k]) => {
      const cut = k.lastIndexOf('|')
      const who = k.slice(0, cut)
      const field = k.slice(cut + 1)
      if (!who) return !field.startsWith('thing:') || things.has(field.slice(6))
      const c = people.get(who)
      if (!c) return false
      if (field.startsWith('clothes:')) return clothesOf(c).some((p) => itemKey(p.name) === field.slice(8))
      return true
    })
  )
}

/** Text as compared for a quote: lower case, letters and numbers only, single spaces. */
const plain = (s: string): string =>
  ' ' +
  s
    .toLowerCase()
    .replace(/[\u2018\u2019'\u0060\u00b4]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim() +
  ' '

/**
 * True when a quote's words are in the text, in order: case, punctuation and spacing aside, and with "…" (or "...")
 * joining two places. Fewer than two words, in any one place, is too little to show anything.
 */
export function quoteFound(quote: string, text: string): boolean {
  const parts = quote
    .split(/\u2026|\.{3}/)
    .map(plain)
    .filter((p) => p.trim())
  if (!parts.length || parts.some((p) => p.split(' ').filter(Boolean).length < 2)) return false
  const body = plain(text)
  let at = 0
  for (const p of parts) {
    const i = body.indexOf(p, at)
    if (i < 0) return false
    at = i + p.length - 1
  }
  return true
}

/** The longest quote kept with a value. */
const LONGEST_QUOTE = 300

// ---------- Something gone: put down, taken off, nothing held ----------
// An empty hand clears what was held (Adam, 2026-10-07: a trap test's memory model said Wren held "nothing" once she
// had put the survey case on the sill, but with no words, so the value was left out and "holding: the survey case"
// carried on; the writer, told she still held it, put the case back under her hand). A value that only says something
// is gone (nothing held, a thing put down or given away, a coat or boots off, barefoot) is taken even without words,
// and laid over what was there piece by piece, so an empty hand or a coat taken off never leaves the old value standing.

/** A value that says there is nothing at all: "nothing", "none", "empty-handed", "naked", "her hands empty". */
const NOTHING = /^(?:nothing|none|naked|empty[- ]?handed|bare[- ]?handed|(?:(?:his|her|their|both) )?hands? (?:are |is )?(?:empty|free))(?![\p{L}])/iu
/** Nothing worn at all (not "nothing on her feet": that is only her feet). */
const NOTHING_WORN = /^(?:nothing(?: at all)?|naked|none)[.!]?$/i
/** Nothing at all, for the field: a hand with nothing in it, or a body with nothing on. */
const allGone = (field: 'holding' | 'wearing', v: string): boolean => (field === 'holding' ? NOTHING : NOTHING_WORN).test(v.trim())
/** A piece of clothing taken off ("boots off, by the hearth", "coat taken off"). */
const TAKEN_OFF = /\b(?:off|taken off|pulled off|kicked off|removed)\b/i
/** Bare feet: nothing on them. */
const BARE_FEET = /\b(?:bare ?foot(?:ed)?|bare[- ]feet|feet bare|stocking(?:ed)? feet|in (?:his|her|their) stockings|no (?:shoes|boots)|nothing on (?:his|her|their) feet)\b/i
const FOOTWEAR = ['boots', 'boot', 'shoes', 'shoe', 'slippers', 'sandals', 'clogs', 'socks', 'stockings', 'feet']
/** A thing put down, hung up or given away ("the case, set on the sill", "Cinder's lead, hung on the mantel"). */
const PUT_DOWN =
  /\b(?:set|put|laid|hung|placed|dropped|propped|stowed|given|handed|gave|passed|lent|left behind)\b[^,;]*?\b(?:down|on|onto|upon|in|into|by|beside|against|under|at|over|across|to|away|aside)\b/i
/** Words that don't name the thing itself. */
const NOT_THINGS = new Set(
  'a an the his her their its my your our this that these those off on onto upon in into by beside against under at over across to away aside down up and or with of nothing none now still just both one two left right hand hands set put laid hung placed dropped propped stowed given handed gave passed lent taken pulled kicked removed'.split(
    ' '
  )
)

/** How a piece that only says more about the thing before it starts ("…, hung on the peg", "…, still laced"). */
const MORE_ABOUT =
  /^(?:on|in|into|by|over|under|beside|at|against|across|round|around|behind|near|from|with|without|hung|set|laid|left|put|placed|thrown|draped|folded|tucked|rolled|pushed|pulled|done|undone|buttoned|unbuttoned|laced|unlaced|still|now|half|torn|soaked|wet|dry|open|closed)\b/i

/**
 * A value's pieces, one per thing: split at semicolons. Clothes with none ("a white shirt, dark trousers, boots off")
 * are split at commas too, each piece that only says more about the one before ("coat off, over the chair") kept with it.
 */
function piecesOf(field: 'holding' | 'wearing', v: string): string[] {
  const parts = v.split(';')
  if (field === 'holding' || parts.length > 1) return parts.map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of v.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (out.length && MORE_ABOUT.test(p)) out[out.length - 1] += `, ${p}`
    else out.push(p)
  }
  return out
}

/** Words that turn a piece round: "the knife, not put down", "boots never taken off". */
const NOT = /\b(?:not|never|without)\b|n[’']t\b/i

/** True when one piece of a holding or wearing value only says something is gone. */
function gonePiece(field: 'holding' | 'wearing', piece: string): boolean {
  if (NOTHING.test(piece)) return true
  if (NOT.test(piece)) return false
  return field === 'holding' ? PUT_DOWN.test(piece) : TAKEN_OFF.test(piece) || BARE_FEET.test(piece)
}

/**
 * True when a holding or wearing value only says what is gone: nothing at all ("nothing", "empty-handed",
 * "nothing; the case on the sill"), or every piece of it a thing put down or given away (held) or taken off (worn).
 */
export function saysGone(field: StateField | 'wearing' | 'time' | 'weather' | 'light', value: string): boolean {
  if (field !== 'holding' && field !== 'wearing') return false
  const v = value.trim()
  if (!v) return false
  if (allGone(field, v)) return true
  const pieces = piecesOf(field, v)
  return pieces.length > 0 && pieces.every((p) => gonePiece(field, p))
}

/** The words that name the thing a piece is about ("Cinder's lead, hung on the mantel" is about "cinder", "lead"). */
function thingWords(field: 'holding' | 'wearing', piece: string): string[] {
  if (field === 'wearing' && BARE_FEET.test(piece)) return FOOTWEAR
  const head = piece.split(',')[0]
  return head
    .toLowerCase()
    .replace(/[‘’']s\b/g, '')
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((w) => w.length >= 3 && !NOT_THINGS.has(w))
}

const hasWord = (text: string, word: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text)

/**
 * What someone holds or wears once something is gone (`now` says only that, saysGone): nothing at all as given; else
 * the pieces of what was there that name something now put down or taken off go, and what is taken off is said (what
 * is put down isn't held, so it isn't). Nothing left in a hand is "nothing". Null when it changes nothing.
 */
export function layGone(field: 'holding' | 'wearing', before: string, now: string): string | null {
  const v = now.trim()
  let out: string
  if (allGone(field, v)) out = v
  else {
    const gone = piecesOf(field, v)
    const words = gone.flatMap((p) => thingWords(field, p))
    const kept = piecesOf(field, before).filter((p) => !words.some((w) => hasWord(p, w)))
    if (field === 'holding') out = kept.length ? kept.join('; ') : before.trim() ? 'nothing' : ''
    else out = [...kept, ...gone].join('; ')
  }
  out = clip(out)
  return out && plain(out) !== plain(before) ? out : null
}

/**
 * A reply read as the changes a stretch of the story makes. Each value is {"value", "quote"}: kept only when the
 * quote's words are in `words` (what the model was given to read), so nothing appears without words behind it; a
 * value given without words, or with words the text doesn't have, is left out. Null when the reply isn't JSON at all.
 * The one exception: a holding or wearing value that only says something is gone (saysGone) is kept even without
 * words, and listed in `gone` with any that do have words, so mergeState lays it over what was there (layGone).
 *
 * Piece by piece (step 2b): each piece of clothing ({"item", "state", "quote"}, under a character's "clothes") and each
 * thing in the place ({"thing", "state", "quote"}, under "things") is kept with its own words; one that only says it
 * is off or gone (boots off; the case picked up) is kept without words too, as an empty hand is. Clothes given the old
 * way, all in one line ("wearing"), are still read, as the whole outfit.
 */
export function readChanges(reply: string, words: string, sceneId: string): (Partial<SceneState> & { said: StateSources; gone: string[] }) | null {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  let v: Record<string, unknown>
  try {
    v = JSON.parse(body) as Record<string, unknown>
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const said: StateSources = {}
  const gone: string[] = []
  /** A quote's words, when they are in what was read. */
  const quoted = (x: unknown): string => {
    const quote = x && typeof x === 'object' ? (x as { quote?: unknown }).quote : undefined
    const q = typeof quote === 'string' ? quote.replace(/\s+/g, ' ').trim().slice(0, LONGEST_QUOTE) : ''
    return q && quoteFound(q, words) ? q : ''
  }
  const backed = (x: unknown, key: string, field: StateField | 'wearing' | 'time' | 'weather' | 'light'): string => {
    if (!x || typeof x !== 'object') return ''
    const val = clip((x as { value?: unknown }).value)
    const q = val ? quoted(x) : ''
    if (val && saysGone(field, val)) gone.push(key)
    else if (!q) return ''
    if (q) said[key] = { quote: q, sceneId }
    return val
  }
  /** Pieces of clothing or things: each with its words, or without when it only says it is off or gone. */
  const listed = (x: unknown, nameKey: 'item' | 'thing', keyOf: (name: string) => string): StageItem[] => {
    const out: StageItem[] = []
    for (const raw of Array.isArray(x) ? x : []) {
      const it = readItem(raw, nameKey)
      if (!it) continue
      // A piece with nothing said of how it is, is on; a thing with nothing said of it says nothing.
      if (nameKey === 'item' && !it.state) it.state = 'on'
      if (!it.state) continue
      const q = quoted(raw)
      if (!q && !isGone(it.state) && !(nameKey === 'item' && isOff(it.state))) continue
      if (q) said[keyOf(it.name)] = { quote: q, sceneId }
      out.push(it)
    }
    return out
  }
  const characters = Array.isArray(v.characters)
    ? (v.characters as Record<string, unknown>[])
        .filter((c) => c && typeof c === 'object' && clip(c.name))
        .map((c) => {
          const name = clip(c.name)
          const out = { name, ...Object.fromEntries(STATE_FIELDS.map((f) => [f, backed(c[f], sourceKey(name, f), f)])) } as CharacterState
          const clothes = listed(c.clothes, 'item', (item) => pieceKey(name, item))
          if (clothes.length) out.clothes = clothes
          else {
            // The old way: all they wear in one line.
            const line = backed(c.wearing, sourceKey(name, 'wearing'), 'wearing')
            if (line) out.wearing = line
          }
          return out
        })
        .filter((c) => STATE_FIELDS.some((f) => c[f]) || c.clothes?.length || c.wearing)
    : []
  return {
    time: backed(v.time, sourceKey(null, 'time'), 'time'),
    weather: backed(v.weather, sourceKey(null, 'weather'), 'weather'),
    light: backed(v.light, sourceKey(null, 'light'), 'light'),
    things: listed(v.things, 'thing', thingKey),
    characters,
    said,
    gone
  }
}

/**
 * The state after a scene: the one before it with what the scene says laid over it. A value the scene gives
 * replaces the old one (Adam: the old is discarded, not kept beside it); what it doesn't mention carries on. A holding
 * or wearing value that only says something is gone (`gone`, from readChanges) is laid over the old one (layGone): an
 * empty hand clears what was held, and its words with it. Piece by piece (step 2b): a change to one piece of clothing,
 * or one thing in the place, touches only that one (boots off leaves the coat as it was); "gone" takes it off the list.
 * The result is always kept piece by piece, whatever the state before was.
 */
export function mergeState(before: SceneState | null, now: Partial<SceneState> & { gone?: string[] }): SceneState {
  const said: StateSources = { ...(before?.said ?? {}) }
  const out: SceneState = before
    ? { ...before, things: thingsOf(before).map((t) => ({ ...t })), characters: before.characters.map((c) => asPieces({ ...c }, said)) }
    : empty()
  // A new value takes its own words, or none: never the old value's.
  const take = (key: string, as = key): void => {
    const from = now.said?.[key]
    if (from) said[as] = from
    else delete said[as]
  }
  for (const k of ['time', 'weather', 'light'] as const)
    if (now[k]) {
      out[k] = now[k]!
      take(sourceKey(null, k))
    }
  if (now.things?.length) {
    const m = mergeItems(thingsOf(out), now.things, false, MOST_THINGS)
    out.things = m.items
    for (const { from, to } of m.changed) take(thingKey(from), thingKey(to))
  }
  const gone = new Set(now.gone ?? [])
  for (const c of now.characters ?? []) {
    let had = out.characters.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
    if (!had) out.characters.push((had = blankCharacter(c.name)))
    for (const f of STATE_FIELDS) {
      const value = c[f]
      if (!value) continue
      const key = sourceKey(c.name, f)
      if (f === 'holding' && gone.has(key)) {
        const laid = layGone(f, had[f], value)
        if (laid === null) continue
        had[f] = laid
      } else had[f] = value
      take(key, sourceKey(had.name, f))
    }
    const who = had.name
    const worn = clothesOf(had)
    if (c.clothes?.length) {
      const m = mergeItems(worn, c.clothes, true, MOST_CLOTHES)
      had.clothes = m.items
      for (const { from, to } of m.changed) take(pieceKey(c.name, from), pieceKey(who, to))
    } else if (c.wearing) {
      // Given the old way: the whole outfit in one line, or only what came off (laid over what was worn).
      const key = sourceKey(c.name, 'wearing')
      const line = gone.has(key) ? layGone('wearing', worn.map(pieceText).join('; '), c.wearing) : c.wearing
      if (line !== null) {
        for (const p of worn) delete said[pieceKey(who, p.name)]
        had.clothes = itemsFromText(line).slice(-MOST_CLOTHES)
        const from = now.said?.[key]
        if (from) for (const p of had.clothes) said[pieceKey(who, p.name)] = from
      }
    }
  }
  // The characters seen most lately first, so a long story keeps the ones that matter.
  const named = new Set((now.characters ?? []).map((c) => c.name.toLowerCase()))
  out.characters.sort((a, b) => Number(named.has(b.name.toLowerCase())) - Number(named.has(a.name.toLowerCase())))
  out.characters = out.characters.slice(0, MOST_TRACKED)
  if (before?.said || now.said) out.said = keepSaid(said, out)
  else delete out.said
  return out
}

// ---------- A new time starts fresh ----------
// The time of day, the light and the weather a scene ends with carry into the next only when both scene cards give the
// same When (Adam, 2026-10-07: "morning, the sun has come up" carried from a Day 23 scene into "Day 23, night, rain",
// and the writer had a man say "Morning"). Otherwise the next scene starts without them, and its own words set them.

const whenText = (s: string | null | undefined): string =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** True when two scene cards' When say the same (case, spacing and punctuation aside); never when either is blank. */
export function sameWhen(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = whenText(a)
  return !!x && x === whenText(b)
}

/** The state without the scene's time, weather and light (and their words): how a new scene with a new time starts. */
export function withoutSceneTime(state: SceneState): SceneState {
  if (!state.time && !state.weather && !state.light) return state
  const out: SceneState = { ...state, time: '', weather: '', light: '' }
  if (state.said) {
    const said = { ...state.said }
    for (const f of ['time', 'weather', 'light']) delete said[sourceKey(null, f)]
    out.said = said
  }
  return out
}

// ---------- A new scene starts with that moment over ----------
// Who touches whom and who can see or hear whom belong to the moment, so a new scene never starts with them (step 2b,
// Adam 2026-10-07). The things in the place (a door barred, a case on the windowsill) carry into the next scene only
// when it is in the same place: both scene cards name the same place (continuity/tracker.ts startFrom).

/** True when two scene cards name the same place; never when either names none. */
export const samePlace = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && a === b

/**
 * The state as a new scene starts from it: without who touches whom or can see or hear whom, and without the things in
 * the place unless it is the same place, their words going with them. The same state, untouched, when there is nothing
 * to take out (so a state kept before step 2b keeps its hash).
 */
export function newSceneStage(state: SceneState, same: boolean): SceneState {
  const things = !same && thingsOf(state).length > 0
  const moment = state.characters.some((c) => c.touching || c.sees)
  if (!things && !moment) return state
  const said: StateSources = { ...(state.said ?? {}) }
  const out: SceneState = {
    ...state,
    characters: state.characters.map((c) => {
      if (!c.touching && !c.sees) return c
      delete said[sourceKey(c.name, 'touching')]
      delete said[sourceKey(c.name, 'sees')]
      return { ...c, touching: '', sees: '' }
    })
  }
  if (things) out.things = []
  if (state.said) out.said = keepSaid(said, out)
  return out
}

/**
 * The state as lines: for the writer, the checks and What the AI saw. `only`: just these characters (names). Each piece
 * of clothing is a line of its own under its person ("  - wearing: boots off, by the door"), and the things in the place
 * follow, one a line, under "Things here:".
 */
export function stateText(state: SceneState, only?: string[]): string {
  const scene = [
    state.time && `Time: ${state.time}`,
    state.weather && `Weather: ${state.weather}`,
    state.light && `Light: ${state.light}`
  ].filter(Boolean)
  const wanted = only?.map((n) => n.toLowerCase())
  const people = state.characters
    .filter((c) => !wanted || wanted.some((n) => c.name.toLowerCase() === n || c.name.toLowerCase().startsWith(`${n} `)))
    .map((c) => {
      const parts = STATE_FIELDS.filter((f) => c[f]).map((f) => `${STATE_LABELS[f]}: ${c[f]}`)
      const worn = clothesOf(c)
        .slice(-MOST_CLOTHES)
        .map((p) => `  - wearing: ${pieceText(p)}`)
      if (!parts.length && !worn.length) return ''
      return [`- ${c.name}${parts.length ? `: ${parts.join('; ')}` : ''}`, ...worn].join('\n')
    })
    .filter(Boolean)
  const things = thingsOf(state)
    .slice(-MOST_THINGS)
    .map((t) => `- ${thingText(t)}`)
  return [scene.join('. '), ...people, ...(things.length ? ['Things here:', ...things] : [])].filter(Boolean).join('\n')
}
