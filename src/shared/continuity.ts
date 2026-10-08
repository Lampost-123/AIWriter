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
  matching,
  mergeItems,
  MOST_CLOTHES,
  MOST_THINGS,
  offState,
  pieceText,
  readItem,
  singular,
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
  /**
   * The words of a whole one-line outfit (kept before step 2b, or given the old way), shared by every piece read from it:
   * they show the line, not this piece, so a slip against the piece is never mended without asking.
   */
  line?: boolean
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
/** The same, as a state kept before step 2b had them (its hash must not change): all they wear in one line. */
const oldBlankCharacter = (name: string): CharacterState => ({
  name,
  where: '',
  wearing: '',
  posture: '',
  holding: '',
  condition: '',
  mood: '',
  lastAction: ''
})
/** True for a state kept before step 2b: no one in it kept piece by piece, and no things. */
const keptBefore2b = (s: SceneState): boolean => !s.things && s.characters.every((c) => !c.clothes)

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

/**
 * The words behind one piece of someone's clothing: its own, or, read from an old one-line "wearing", that line's
 * (shared, `line`, when the line holds more pieces than this one: `pieces`, how many it was read as).
 */
export function pieceSource(said: StateSources | undefined, character: string, item: string, pieces = 2): StateSource | undefined {
  const own = said?.[pieceKey(character, item)]
  if (own) return own
  const line = said?.[sourceKey(character, 'wearing')]
  return line && (pieces > 1 ? { ...line, line: true } : line)
}

/** A character as step 2b keeps them: what they wear piece by piece, the words of an old one-line "wearing" on each piece. */
function asPieces(c: CharacterState, said: StateSources): CharacterState {
  if (c.clothes) return c
  const { wearing, ...rest } = c
  const clothes = itemsFromText(wearing ?? '')
  const old = said[sourceKey(c.name, 'wearing')]
  if (old) for (const p of clothes) said[pieceKey(c.name, p.name)] ??= clothes.length > 1 ? { ...old, line: true } : old
  delete said[sourceKey(c.name, 'wearing')]
  return { ...rest, clothes }
}

/**
 * Which piece or thing an edit of Adam's is about, by the name it had when he made it: the one `matching` finds ("boots"
 * is the "riding boots" read again from the same words), or the one an old long name says ("a white shirt unbuttoned to
 * the waist" is the "shirt"), when there is just one; else the one with that very name; -1 for none.
 */
function editedAt(list: StageItem[], key: string, clothing: boolean): number {
  const found = matching(list, key, clothing)
  if (found.length === 1) return found[0]
  // A long name, as old lines had ("white shirt unbuttoned to the waist"): the one piece its words name.
  if (key.split(' ').length > 2) {
    const back = list.map((x, i) => (matching([{ name: key, state: '' }], x.name, clothing).length ? i : -1)).filter((i) => i >= 0)
    if (back.length === 1) return back[0]
  }
  return list.findIndex((x) => itemKey(x.name) === key)
}

/** A list with Adam's changes laid over it, each by the name of the piece or thing it was (null: taken out; new: added). */
function itemEdits(list: StageItem[], edits: Record<string, StageItem | null>, forget: (name: string) => void, clothing: boolean): StageItem[] {
  let out = list.map((x) => ({ ...x }))
  for (const [key, now] of Object.entries(edits)) {
    const at = editedAt(out, key, clothing)
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
    if (at < 0) at = out.characters.push((keptBefore2b(state) ? oldBlankCharacter : blankCharacter)(values.name ?? name)) - 1
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
      c.clothes = itemEdits(c.clothes!, values.clothes, (p) => delete said[pieceKey(who, p)], true)
    }
  }
  if (edits.things) out.things = itemEdits(thingsOf(out), edits.things, (t) => delete said[thingKey(t)], false)
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

// ---------- "The door", when two doors are named ----------
// The memory model named a thing by the nearest name the words gave (lab round E, record 52622830): "at the passage door
// she put her hand on the iron ring ... at the end of it the yard door stood open ... She put her shoulder to the door
// and shut it ... she turned the key", read as "the yard door: shut and locked from inside", while the lock may as well
// be on the passage door she came through. The words don't say which, so neither name is kept as if they did: a thing
// whose name says which one it is ("the yard door"), when its own words don't say so ("the door") and the words just
// before name two or more of its kind, is kept as "the door (the yard door or the passage door?)".

/** Words before a thing's main word that only say how it looks, not which one it is ("the heavy door"). */
const LOOKS_ONLY = new Set(
  'a an the this that these those his her their its my your our one other same open shut closed locked unlocked barred bolted heavy old great big small little low narrow wide thick stout battered half ajar near far nearest first second last only'.split(
    ' '
  )
)
/** How far before a thing's words other names of its kind count, in characters of the words as compared. */
const NAMED_NEAR = 1200

/** The words of a name that say which one it is: "yard" for "the yard door", '' for "the door" or "the heavy door". */
const whichOf = (words: string[]): string => words.filter((w) => !LOOKS_ONLY.has(w)).join(' ')

/**
 * A thing's name as its words bear it out (see above): as given, unless it says which one it is, its quote doesn't, and
 * the words up to the quote's end (the last NAMED_NEAR characters before it) name two or more of its kind by which.
 */
export function unnamed(name: string, quote: string, words: string): string {
  const key = itemKey(name).split(' ')
  const head = singular(key.at(-1) ?? '')
  const which = whichOf(key.slice(0, -1))
  if (head.length < 3 || !which) return name
  const q = plain(quote)
  if (which.split(' ').every((w) => q.includes(` ${w} `))) return name
  // Where the quote's words end in the words read.
  const body = plain(words)
  const parts = quote
    .split(/…|\.{3}/)
    .map(plain)
    .filter((p) => p.trim())
  let first = -1
  let end = 0
  for (const p of parts) {
    const i = body.indexOf(p, end)
    if (i < 0) return name
    if (first < 0) first = i
    end = i + p.length
  }
  const near = body.slice(Math.max(0, first - NAMED_NEAR), end)
  // Each of its kind named there, by which ("the yard door", "a passage door"), the latest last.
  const named: string[] = []
  const kind = new RegExp(`(?<= )(?:the|a|an|this|that|his|her|their|its) ((?:[\\p{L}\\p{N}]+ ){1,2})${head}s?(?= )`, 'gu')
  for (const m of near.matchAll(kind)) {
    const w = whichOf(m[1].trim().split(' '))
    if (!w) continue
    const i = named.indexOf(w)
    if (i >= 0) named.splice(i, 1)
    named.push(w)
  }
  if (named.length < 2) return name
  const said = named.slice(-2).reverse()
  return `the ${head} (${said.map((w) => `the ${w} ${head}`).join(' or ')}?)`
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
      // A piece "removed" or "no longer worn" is off, and stays on the list as off.
      if (nameKey === 'item') it.state = offState(it.state)
      if (!it.state) continue
      const q = quoted(raw)
      if (!q && !isGone(it.state, nameKey === 'item') && !(nameKey === 'item' && isOff(it.state))) continue
      // "the door", when two doors are named just before it, is not the nearer one's name (unnamed).
      if (q && nameKey === 'thing') it.name = unnamed(it.name, q, words)
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

// ---------- One place for each thing ----------
// A thing is in one place at a time (Adam, 2026-10-07, "fix the case slip first"). In a trap run Wren set the survey
// case down flat on the sill; the memory model put the case there and emptied her hand, but its list of what she wore
// left out the case strap, so "case strap on, case on her back" carried on beside "the survey case: on the windowsill".
// Told both, the writer had her sit up with the case against her hip. So when a thing is put somewhere, a piece someone
// has on or anything they hold that names it goes: put down means not worn or held. When someone takes it up (holds it
// or puts it on, with words that show it), it is no longer where it was. A piece a change simply leaves out keeps its
// value (leaving out isn't taking off); only one that names a thing now put somewhere else goes.

/** A thing's state that says where it was put, so it isn't worn or held: "on the windowsill, flat", "hung on the peg". */
const PLACED =
  /^(?:on|onto|upon|in|inside|into|under|underneath|beneath|by|beside|against|at|across|over|behind|near|next to|propped|leaning|lying|standing|resting|hung|hanging|set|laid|left|put|placed|dropped|stowed|tucked|stood|sitting)\b/i
/** A state that says the thing is on or with someone ("on Ash's feet", "in her pocket", "at her side"): not put down. */
const ON_SOMEONE =
  /\b(?:feet|foot|head|back|shoulders?|hands?|arms?|wrists?|fingers?|neck|hips?|waist|belt|lap|knees?|thighs?|side|body|pocket|pack|saddle|worn|wearing|carried|held|holding)\b/i
/**
 * True when a thing's state says where it was put ("on the windowsill, flat"), not how it is ("barred from inside") nor
 * that someone has it ("on Ash's feet").
 */
export const isPlaced = (state: string): boolean => PLACED.test(state.trim()) && !ON_SOMEONE.test(state)
/** Words that show something taken up: "snatched up the case", "lifted it off the sill", "slung it on". */
const TAKE_UP =
  /\b(?:pick(?:s|ed|ing)? up|took|takes|taken|lift(?:s|ed)?|snatch(?:es|ed)?|grab(?:s|bed)?|caught up|catch(?:es)? up|gather(?:s|ed)? up|sl(?:ing|ings|ung)|shoulder(?:s|ed)|hoist(?:s|ed)?|fetch(?:es|ed)?|seiz(?:es|ed)|swept up|scoop(?:s|ed)? up|reach(?:es|ed)? for|buckl(?:es|ed)|strapp(?:ed)?|put (?:it|them) on|pull(?:s|ed) (?:it|them) on)\b/i
/** Words that show something put down: "set the case down flat on the sill", "hung it on the peg". */
const PUT_WORDS = /\b(?:set|sets|put|puts|laid|lays|lay|hung|hangs|placed|places|dropped|drops|propped|props|stood|stands|left|leaves|stowed|tucked|leaned|leant|rested)\b/i

/** The word a thing is known by: "case" for "the survey case", "plate" for "the plate of bread and dripping". */
function objectWord(name: string): string {
  const key = itemKey(name).split(/\s+(?:of|from|for|with|in|on|at|to)\s+/)[0] ?? ''
  const w = key.split(' ').at(-1) ?? ''
  return w.length >= 3 ? w : ''
}

/** Whose a thing is, when its name says ("Ash's coat": "ash"); '' otherwise. */
const ownerOf = (name: string): string => /^(?:the\s+)?(\p{Lu}[\p{L}-]*)['’]s\s/u.exec(name.trim())?.[1]?.toLowerCase() ?? ''

/** Words as told apart here: lower case, a hyphenated word one word ("fire-scorched" isn't "fire"), "Ash's" as "ash". */
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean)

/** True when `text` names a thing known by `word`: the word, or one of many for one ("cases"), never one for many ("mug" isn't "the mugs"). */
function namesObject(text: string, word: string): boolean {
  if (!word) return false
  const many = singular(word) !== word
  return tokens(text).some((w) => (many ? w === word : singular(w) === word))
}

/** The words of a piece of clothing that say what it is: its name ("case strap"), or an old line's words before "on" or "off". */
const pieceWords = (p: StageItem): string => (p.state ? p.name : (p.name.split(/\s+(?:on|off)\b|[(,;]/i)[0] ?? ''))
/** True when a piece is on them (not off, wherever it is). */
const isOn = (p: StageItem): boolean => (p.state ? !isOff(p.state) : !/\boff\b/i.test(p.name))
/** The words of a held piece that say what it is: "the case" in "the case under her arm, strap wound round her wrist". */
const heldWords = (piece: string): string => piece.split(',')[0] ?? ''

/** What a change set says each person took up: whether it gave what they hold, and the pieces of clothing it gave. */
type Given = Map<CharacterState, { holding: boolean; pieces: Set<string> }>

/** The pieces someone wears (on or off) that name a thing known by `word`. */
const wornNaming = (c: CharacterState, word: string): StageItem[] => clothesOf(c).filter((x) => namesObject(pieceWords(x), word))
/** The parts of what someone holds that name it ("the case under her arm" in "the case under her arm; a candle"). */
const heldNaming = (c: CharacterState, word: string): string[] =>
  piecesOf('holding', c.holding).filter((h) => !gonePiece('holding', h) && namesObject(heldWords(h), word))

/**
 * Whom a thing put somewhere is about: the one its name says ("Ash's coat" is only Ash's); else the one person who has on
 * or holds something that names it. Nobody when someone has such a piece off (the boots by the hearth are the ones taken
 * off) or more than one person has one on or in hand (whose would it be?).
 */
function whoseIt(people: CharacterState[], t: StageItem, word: string): CharacterState[] {
  const owner = ownerOf(t.name)
  if (owner) return people.filter((c) => tokens(c.name).includes(owner))
  if (people.some((c) => wornNaming(c, word).some((p) => !isOn(p)))) return []
  const some = people.filter((c) => wornNaming(c, word).some(isOn) || heldNaming(c, word).length > 0)
  return some.length === 1 ? some : []
}

/**
 * One place for each thing (see above): for each thing put somewhere, the pieces worn and the things held that name it,
 * by whomever it is about (whoseIt). When this change set has them take it up, with words that show it (that name it, or
 * say it was picked up or put on), and it wasn't put down in the same change with words that show that, the thing is no
 * longer where it was; otherwise they no longer wear or hold it, and the words of what they held go.
 */
function onePlace(out: SceneState, said: StateSources, placedNow: Set<string>, given: Given): void {
  const quoteOf = (key: string): string => said[key]?.quote ?? ''
  const takenUp = new Set<StageItem>()
  for (const t of thingsOf(out)) {
    const word = objectWord(t.name)
    if (!word || !isPlaced(t.state)) continue
    const tq = quoteOf(thingKey(t.name))
    const putHere = placedNow.has(t.name) && (namesObject(tq, word) || PUT_WORDS.test(tq))
    const shown = (q: string): boolean => namesObject(q, word) || TAKE_UP.test(q)
    const clashes: (() => void)[] = []
    for (const c of whoseIt(out.characters, t, word)) {
      const mine = given.get(c)
      for (const p of wornNaming(c, word).filter(isOn)) {
        if (mine?.pieces.has(p.name) && shown(quoteOf(pieceKey(c.name, p.name))) && !putHere) takenUp.add(t)
        else clashes.push(() => (c.clothes = clothesOf(c).filter((x) => x !== p)))
      }
      const named = heldNaming(c, word)
      if (!named.length) continue
      if (mine?.holding && shown(quoteOf(sourceKey(c.name, 'holding'))) && !putHere) takenUp.add(t)
      else
        clashes.push(() => {
          const kept = piecesOf('holding', c.holding).filter((h) => !named.includes(h))
          c.holding = kept.length ? kept.join('; ') : 'nothing'
          delete said[sourceKey(c.name, 'holding')]
        })
    }
    if (!takenUp.has(t)) for (const clear of clashes) clear()
  }
  if (takenUp.size) out.things = thingsOf(out).filter((t) => !takenUp.has(t))
}

/** The thing the stage has put somewhere that `words` (what `who` wears or holds) name, when it is about them (whoseIt). */
function placedThing(state: Pick<SceneState, 'things' | 'characters'>, who: string, words: string): StageItem | null {
  const me = (c: CharacterState): boolean => c.name.toLowerCase() === who.toLowerCase()
  return (
    thingsOf(state).find((t) => {
      const word = objectWord(t.name)
      return isPlaced(t.state) && namesObject(words, word) && whoseIt(state.characters, t, word).some(me)
    }) ?? null
  )
}

/**
 * True when a piece someone has on names a thing the stage has put somewhere ("case strap on" with the survey case on the
 * windowsill): the two can't both be told (ai/mustStay.ts tells the thing). Never for a piece that is off.
 */
export const pieceClashes = (state: Pick<SceneState, 'things' | 'characters'>, who: string, p: StageItem): boolean =>
  isOn(p) && !!placedThing(state, who, pieceWords(p))

/** What someone holds without anything the stage has put somewhere ("the case; the lamp" with the case on the sill is "the lamp"); '' for nothing left. */
export function heldNotPlaced(state: Pick<SceneState, 'things' | 'characters'>, who: string, holding: string): string {
  const parts = piecesOf('holding', holding)
  const kept = parts.filter((h) => gonePiece('holding', h) || !placedThing(state, who, heldWords(h)))
  return kept.length === parts.length ? holding : kept.join('; ')
}

// ---------- How someone is placed belongs to where they are ----------
// A field a reply leaves out carries on, so a move that said nothing of how someone is placed kept the old pose (the
// lab's bridge reviews B and C: Ash "riding, hands in his armpits" in the inn's parlour, and "sitting on the settle...
// looking at Wren" once he had gone out to the stable). How they are placed, who they touch and who they see or hear
// belong to the place: when where they are changes, those go unless the same change gives them again. What they hold,
// wear, how they are and how they feel go with them. Someone else touching them or watching them loses that too.

/** The fields that belong to where someone is. */
const PLACE_BOUND = ['posture', 'touching', 'sees'] as const

/** A place as compared: lower case, words only. */
const placeWords = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** True when someone known to be somewhere is now said to be somewhere else (never for a first where). */
const movedOn = (was: string, now: string | undefined): boolean => !!now && !!placeWords(was) && placeWords(was) !== placeWords(now)

/** True when a value names this person: any word of their name, capitalised as names are ("Ash" in "looking at Ash"). */
function namesPerson(value: string, name: string): boolean {
  if (!value) return false
  return name
    .split(/\s+/)
    .filter((w) => w.length >= 3 && /^\p{Lu}/u.test(w))
    .some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(value))
}

/**
 * After a move (see above): for each person who moved, how they are placed, who they touch and who they see go unless
 * the change set gave them again, their words with them; anyone else who touches or sees a person who moved, and isn't
 * said to again, no longer does.
 */
function placedAfterMove(out: SceneState, said: StateSources, moved: CharacterState[], restated: Map<CharacterState, Partial<CharacterState>>): void {
  if (!moved.length) return
  const clear = (c: CharacterState, f: (typeof PLACE_BOUND)[number]): void => {
    if (restated.get(c)?.[f]) return
    if (c[f]) c[f] = ''
    delete said[sourceKey(c.name, f)]
  }
  for (const c of moved) for (const f of PLACE_BOUND) clear(c, f)
  for (const c of out.characters) {
    if (moved.includes(c)) continue
    for (const f of ['touching', 'sees'] as const) if (moved.some((m) => namesPerson(c[f] ?? '', m.name))) clear(c, f)
  }
}

/**
 * The state after a scene: the one before it with what the scene says laid over it. A value the scene gives
 * replaces the old one (Adam: the old is discarded, not kept beside it); what it doesn't mention carries on, except how
 * someone is placed, who they touch and who they see, which go when they move (placedAfterMove). A holding
 * or wearing value that only says something is gone (`gone`, from readChanges) is laid over the old one (layGone): an
 * empty hand clears what was held, and its words with it. Piece by piece (step 2b): a change to one piece of clothing,
 * or one thing in the place, touches only that one (boots off leaves the coat as it was); "gone" takes it off the list.
 * Each thing is in one place (onePlace): a thing put somewhere is no longer worn or held, and one taken up is no longer
 * where it was. The result is always kept piece by piece, whatever the state before was.
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
  // The things this change set put somewhere, by the name each is kept under (onePlace).
  const placedNow = new Set<string>()
  if (now.things?.length) {
    const m = mergeItems(thingsOf(out), now.things, false, MOST_THINGS)
    out.things = m.items
    for (const { from, to } of m.changed) {
      take(thingKey(from), thingKey(to))
      placedNow.add(to)
    }
  }
  const gone = new Set(now.gone ?? [])
  /** What this change set says each person (by the name kept) took up: what they hold now, the pieces they have on now. */
  const given: Given = new Map()
  /** Who moved somewhere else in this change set (moved), and what the change set gave each person. */
  const moved: CharacterState[] = []
  const restated = new Map<CharacterState, Partial<CharacterState>>()
  for (const c of now.characters ?? []) {
    let had = out.characters.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
    if (!had) out.characters.push((had = blankCharacter(c.name)))
    const mine = { holding: false, pieces: new Set<string>() }
    given.set(had, mine)
    restated.set(had, c)
    if (movedOn(had.where, c.where)) moved.push(had)
    for (const f of STATE_FIELDS) {
      const value = c[f]
      if (!value) continue
      const key = sourceKey(c.name, f)
      if (f === 'holding' && gone.has(key)) {
        const laid = layGone(f, had[f], value)
        if (laid === null) continue
        had[f] = laid
      } else {
        had[f] = value
        if (f === 'holding') mine.holding = true
      }
      take(key, sourceKey(had.name, f))
    }
    const who = had.name
    const worn = clothesOf(had)
    if (c.clothes?.length) {
      const m = mergeItems(worn, c.clothes, true, MOST_CLOTHES)
      had.clothes = m.items
      for (const { from, to } of m.changed) {
        take(pieceKey(c.name, from), pieceKey(who, to))
        mine.pieces.add(to)
      }
    } else if (c.wearing) {
      // Given the old way: the whole outfit in one line, or only what came off (laid over what was worn).
      const key = sourceKey(c.name, 'wearing')
      const line = gone.has(key) ? layGone('wearing', worn.map(pieceText).join('; '), c.wearing) : c.wearing
      if (line !== null) {
        for (const p of worn) delete said[pieceKey(who, p.name)]
        had.clothes = itemsFromText(line).slice(-MOST_CLOTHES)
        if (!gone.has(key)) for (const p of had.clothes) mine.pieces.add(p.name)
        const from = now.said?.[key]
        if (from) for (const p of had.clothes) said[pieceKey(who, p.name)] = had.clothes.length > 1 ? { ...from, line: true } : from
      }
    }
  }
  placedAfterMove(out, said, moved, restated)
  onePlace(out, said, placedNow, given)
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

/** The most of one piece's or thing's words told, and of all a person wears and of all the things, in characters. */
const TOLD_ONE = 160
const TOLD_WORN = 400
const TOLD_THINGS = 600

/** Lines cut to TOLD_ONE each, as many as fit in `most` characters; the most lately changed (the last) kept first. */
function capped(lines: string[], most: number): string[] {
  const out: string[] = []
  let used = 0
  for (const l of [...lines].reverse()) {
    const one = l.length > TOLD_ONE ? `${l.slice(0, TOLD_ONE - 1).trimEnd()}…` : l
    if (used + one.length > most) break
    used += one.length
    out.unshift(one)
  }
  return out
}

/** What someone wears as lines under them, as much as fits (TOLD_WORN). */
const wornLines = (pieces: StageItem[]): string[] => capped(pieces.map(pieceText), TOLD_WORN).map((p) => `  - wearing: ${p}`)

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
      const worn = wornLines(clothesOf(c).slice(-MOST_CLOTHES))
      if (!parts.length && !worn.length) return ''
      return [`- ${c.name}${parts.length ? `: ${parts.join('; ')}` : ''}`, ...worn].join('\n')
    })
    .filter(Boolean)
  const things = capped(thingsOf(state).slice(-MOST_THINGS).map(thingText), TOLD_THINGS).map((t) => `- ${t}`)
  return [scene.join('. '), ...people, ...(things.length ? ['Things here:', ...things] : [])].filter(Boolean).join('\n')
}
