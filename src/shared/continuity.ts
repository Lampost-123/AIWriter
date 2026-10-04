// Where things stand (Adam, 2026-10-04): what the continuity tracker keeps for each character as a scene ends, and
// for the scene (src/main/continuity/tracker.ts), in plain data, with how it reads and how a scene's changes are
// laid over the state before. Shared by the main process and the Recall panel. Pure.

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
}

export const STATE_FIELDS = ['where', 'wearing', 'posture', 'holding', 'condition', 'mood', 'lastAction'] as const
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
/** The longest a value is kept. */
export const LONGEST_VALUE = 160
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
  const removed = new Set((edits.removed ?? []).map((n) => n.toLowerCase()))
  out.characters = out.characters.filter((c) => !removed.has(c.name.toLowerCase()))
  for (const [name, values] of Object.entries(edits.characters ?? {})) {
    if (removed.has(name)) continue
    let c = out.characters.find((x) => x.name.toLowerCase() === name)
    if (!c) {
      c = { name: values.name ?? name, ...Object.fromEntries(STATE_FIELDS.map((f) => [f, ''])) } as CharacterState
      out.characters.push(c)
    }
    for (const f of STATE_FIELDS) if (values[f] !== undefined) c[f] = (values[f] ?? '').slice(0, LONGEST_VALUE)
  }
  return out
}

/** A reply read: whatever it gives that looks right, the rest left out. Null when it isn't JSON at all. */
export function readState(reply: string): Partial<SceneState> | null {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  let v: Record<string, unknown>
  try {
    v = JSON.parse(body) as Record<string, unknown>
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const characters = Array.isArray(v.characters)
    ? (v.characters as Record<string, unknown>[])
        .filter((c) => c && typeof c === 'object' && clip(c.name))
        .map((c) => ({ name: clip(c.name), ...Object.fromEntries(STATE_FIELDS.map((f) => [f, clip(c[f])])) }) as CharacterState)
    : []
  return { time: clip(v.time), weather: clip(v.weather), light: clip(v.light), characters }
}

/**
 * The state after a scene: the one before it with what the scene says laid over it. A value the scene gives
 * replaces the old one (Adam: the old is discarded, not kept beside it); what it doesn't mention carries on.
 */
export function mergeState(before: SceneState | null, now: Partial<SceneState>): SceneState {
  const out: SceneState = before ? { ...before, characters: before.characters.map((c) => ({ ...c })) } : empty()
  for (const k of ['time', 'weather', 'light'] as const) if (now[k]) out[k] = now[k]!
  for (const c of now.characters ?? []) {
    const had = out.characters.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
    if (!had) {
      out.characters.push({ ...c })
      continue
    }
    for (const f of STATE_FIELDS) if (c[f]) had[f] = c[f]
  }
  // The characters seen most lately first, so a long story keeps the ones that matter.
  const named = new Set((now.characters ?? []).map((c) => c.name.toLowerCase()))
  out.characters.sort((a, b) => Number(named.has(b.name.toLowerCase())) - Number(named.has(a.name.toLowerCase())))
  out.characters = out.characters.slice(0, MOST_TRACKED)
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

