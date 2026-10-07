// Where things stand (Adam, 2026-10-04): what the continuity tracker keeps for each character as a scene ends, and
// for the scene (src/main/continuity/tracker.ts), in plain data, with how it reads and how a scene's changes are
// laid over the state before. Changes, not guesses (Adam, 2026-10-07): every value the memory model gives comes with
// the words that show it, and one whose words aren't in the text is left out. Shared by the main process and the
// Recall panel. Pure.

/** One character as a scene ends. '' where the story hasn't said. */
export interface CharacterState {
  name: string
  where: string
  wearing: string
  posture: string
  holding: string
  condition: string
  mood: string
  lastAction: string
}

export interface SceneState {
  time: string
  weather: string
  light: string
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

export const STATE_FIELDS = ['where', 'wearing', 'posture', 'holding', 'condition', 'mood', 'lastAction'] as const
/** One of the values kept for each character. */
export type StateField = (typeof STATE_FIELDS)[number]
/** Words for each field, as the writer and Adam read them. */
export const STATE_LABELS: Record<(typeof STATE_FIELDS)[number], string> = {
  where: 'where',
  wearing: 'wearing',
  posture: 'position',
  holding: 'holding',
  condition: 'condition',
  mood: 'mood',
  lastAction: 'last did'
}
/** The most characters kept. */
export const MOST_TRACKED = 40
/** The longest a value is kept: room for every piece of clothing and how it sits, or a full description of a pose. */
export const LONGEST_VALUE = 400
const clip = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, LONGEST_VALUE) : '')
const empty = (): SceneState => ({ time: '', weather: '', light: '', characters: [] })

/** Adam's own changes to a scene's state: values by character (name, lower case) or for the scene, and who he took out. */
export interface StateEdits {
  scene?: Partial<Record<'time' | 'weather' | 'light', string>>
  characters?: Record<string, Partial<Record<(typeof STATE_FIELDS)[number] | 'name', string>>>
  removed?: string[]
}

/** A kept state with Adam's edits laid over it. */
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
    let c = out.characters.find((x) => x.name.toLowerCase() === name)
    if (!c) {
      c = { name: values.name ?? name, ...Object.fromEntries(STATE_FIELDS.map((f) => [f, ''])) } as CharacterState
      out.characters.push(c)
    }
    for (const f of STATE_FIELDS)
      if (values[f] !== undefined) {
        c[f] = (values[f] ?? '').slice(0, LONGEST_VALUE)
        delete said[sourceKey(c.name, f)]
      }
  }
  if (state.said) out.said = keepSaid(said, out)
  return out
}

/** Only the words behind values still there. */
function keepSaid(said: StateSources, state: SceneState): StateSources {
  const names = new Set(['', ...state.characters.map((c) => c.name.toLowerCase())])
  return Object.fromEntries(Object.entries(said).filter(([k]) => names.has(k.slice(0, k.lastIndexOf('|')))))
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
export function saysGone(field: StateField | 'time' | 'weather' | 'light', value: string): boolean {
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
  const backed = (x: unknown, key: string, field: StateField | 'time' | 'weather' | 'light'): string => {
    if (!x || typeof x !== 'object') return ''
    const { value, quote } = x as { value?: unknown; quote?: unknown }
    const val = clip(value)
    const q = typeof quote === 'string' ? quote.replace(/\s+/g, ' ').trim().slice(0, LONGEST_QUOTE) : ''
    const found = !!val && !!q && quoteFound(q, words)
    if (val && saysGone(field, val)) gone.push(key)
    else if (!found) return ''
    if (found) said[key] = { quote: q, sceneId }
    return val
  }
  const characters = Array.isArray(v.characters)
    ? (v.characters as Record<string, unknown>[])
        .filter((c) => c && typeof c === 'object' && clip(c.name))
        .map((c) => {
          const name = clip(c.name)
          return { name, ...Object.fromEntries(STATE_FIELDS.map((f) => [f, backed(c[f], sourceKey(name, f), f)])) } as CharacterState
        })
        .filter((c) => STATE_FIELDS.some((f) => c[f]))
    : []
  return {
    time: backed(v.time, sourceKey(null, 'time'), 'time'),
    weather: backed(v.weather, sourceKey(null, 'weather'), 'weather'),
    light: backed(v.light, sourceKey(null, 'light'), 'light'),
    characters,
    said,
    gone
  }
}

/**
 * The state after a scene: the one before it with what the scene says laid over it. A value the scene gives
 * replaces the old one (Adam: the old is discarded, not kept beside it); what it doesn't mention carries on. A holding
 * or wearing value that only says something is gone (`gone`, from readChanges) is laid over the old one (layGone): an
 * empty hand clears what was held, and its words with it.
 */
export function mergeState(before: SceneState | null, now: Partial<SceneState> & { gone?: string[] }): SceneState {
  const out: SceneState = before ? { ...before, characters: before.characters.map((c) => ({ ...c })) } : empty()
  const said: StateSources = { ...(before?.said ?? {}) }
  // A new value takes its own words, or none: never the old value's.
  const take = (key: string): void => {
    const from = now.said?.[key]
    if (from) said[key] = from
    else delete said[key]
  }
  for (const k of ['time', 'weather', 'light'] as const)
    if (now[k]) {
      out[k] = now[k]!
      take(sourceKey(null, k))
    }
  const gone = new Set(now.gone ?? [])
  for (const c of now.characters ?? []) {
    let had = out.characters.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
    if (!had) out.characters.push((had = { ...c, ...Object.fromEntries(STATE_FIELDS.map((f) => [f, ''])) }))
    for (const f of STATE_FIELDS) {
      if (!c[f]) continue
      const key = sourceKey(c.name, f)
      if ((f === 'holding' || f === 'wearing') && gone.has(key)) {
        const laid = layGone(f, had[f], c[f])
        if (laid === null) continue
        had[f] = laid
      } else had[f] = c[f]
      take(sourceKey(had.name, f))
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

/** The state as lines: for the writer, the checks and What the AI saw. `only`: just these characters (names). */
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
      return parts.length ? `- ${c.name}: ${parts.join('; ')}` : ''
    })
    .filter(Boolean)
  return [scene.join('. '), ...people].filter(Boolean).join('\n')
}
