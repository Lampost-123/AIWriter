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

/**
 * A reply read as the changes a stretch of the story makes. Each value is {"value", "quote"}: kept only when the
 * quote's words are in `words` (what the model was given to read), so nothing appears without words behind it; a
 * value given without words, or with words the text doesn't have, is left out. Null when the reply isn't JSON at all.
 */
export function readChanges(reply: string, words: string, sceneId: string): (Partial<SceneState> & { said: StateSources }) | null {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  let v: Record<string, unknown>
  try {
    v = JSON.parse(body) as Record<string, unknown>
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const said: StateSources = {}
  const backed = (x: unknown, key: string): string => {
    if (!x || typeof x !== 'object') return ''
    const { value, quote } = x as { value?: unknown; quote?: unknown }
    const val = clip(value)
    const q = typeof quote === 'string' ? quote.replace(/\s+/g, ' ').trim().slice(0, LONGEST_QUOTE) : ''
    if (!val || !q || !quoteFound(q, words)) return ''
    said[key] = { quote: q, sceneId }
    return val
  }
  const characters = Array.isArray(v.characters)
    ? (v.characters as Record<string, unknown>[])
        .filter((c) => c && typeof c === 'object' && clip(c.name))
        .map((c) => {
          const name = clip(c.name)
          return { name, ...Object.fromEntries(STATE_FIELDS.map((f) => [f, backed(c[f], sourceKey(name, f))])) } as CharacterState
        })
        .filter((c) => STATE_FIELDS.some((f) => c[f]))
    : []
  return {
    time: backed(v.time, sourceKey(null, 'time')),
    weather: backed(v.weather, sourceKey(null, 'weather')),
    light: backed(v.light, sourceKey(null, 'light')),
    characters,
    said
  }
}

/**
 * The state after a scene: the one before it with what the scene says laid over it. A value the scene gives
 * replaces the old one (Adam: the old is discarded, not kept beside it); what it doesn't mention carries on.
 */
export function mergeState(before: SceneState | null, now: Partial<SceneState>): SceneState {
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
  for (const c of now.characters ?? []) {
    let had = out.characters.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
    if (!had) out.characters.push((had = { ...c, ...Object.fromEntries(STATE_FIELDS.map((f) => [f, ''])) }))
    for (const f of STATE_FIELDS)
      if (c[f]) {
        had[f] = c[f]
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
