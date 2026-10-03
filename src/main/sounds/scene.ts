// A scene's sounds as they stand (AI sound effects under Read aloud): the AI's marks for paragraphs whose words are
// the ones they were made for, and Adam's for the paragraphs that are his, in reading order, each found again where
// its words are now; and the sounds each clip of a reading carries (an effect firing, an ambience starting or
// ending, on the word it is anchored to) with the ambience in force as each clip starts. Pure.
import type { ClipSound, PlannedClip } from '@shared/contracts/readAloud'
import type { CueAnchor, SceneCue, SoundCue, SoundEdits, SoundKind } from '@shared/contracts/sounds'
import { textHash } from '../readAloud/marks'

/** A sound the AI marked, as kept with its paragraph (marks.ts). */
export interface MarkedCue {
  id: string
  kind: SoundKind
  description: string
  /** How long an effect should be, as the AI said. */
  seconds?: number
  at: CueAnchor
  until: CueAnchor | null
  /** The hash of the words of `until`'s paragraph when it was marked (it may be a later paragraph than `at`'s). */
  untilHash?: string
}

/** A library sound as a cue sees it. */
export interface SoundOf {
  id: string
  state: SceneCue['sound']
  /** A new take of it: being made, or made with the take before kept aside. */
  retake?: SceneCue['retake']
}

export interface Paragraph {
  pid: string
  text: string
}

/**
 * Where an anchor's words are now: where they were if they are still there, else the occurrence nearest to where
 * they were (`placed` true); else the same place, kept inside the paragraph (`placed` false).
 */
export function relocate(text: string, a: CueAnchor): { anchor: CueAnchor; placed: boolean } {
  const from = Math.max(0, Math.min(text.length, Math.round(a.from)))
  const to = Math.max(from, Math.min(text.length, Math.round(a.to)))
  if (a.words && text.slice(a.from, a.to) === a.words) return { anchor: { ...a }, placed: true }
  if (a.words) {
    let best = -1
    for (const caseless of [false, true]) {
      const hay = caseless ? text.toLowerCase() : text
      const needle = caseless ? a.words.toLowerCase() : a.words
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
        if (best < 0 || Math.abs(i - a.from) < Math.abs(best - a.from)) best = i
      }
      if (best >= 0) break
    }
    if (best >= 0) return { anchor: { pid: a.pid, from: best, to: best + a.words.length, words: text.slice(best, best + a.words.length) }, placed: true }
  }
  return { anchor: { pid: a.pid, from, to, words: text.slice(from, to) }, placed: false }
}

export interface SceneInput {
  /** The scene's paragraphs, in order. */
  paragraphs: readonly Paragraph[]
  /** The AI's marks for paragraphs whose words are the ones they were made for, by the paragraph each starts in. */
  ai: ReadonlyMap<string, MarkedCue[]>
  /** Adam's (world meta `sounds`). */
  edits: SoundEdits | null
  /** The library sound for a description, if there is one (`seconds`: how long an effect was asked to be). */
  sound(kind: SoundKind, description: string, seconds?: number): SoundOf | null
}

/** A scene's sounds in reading order. */
export function sceneCues(input: SceneInput): SceneCue[] {
  const byPid = new Map(input.paragraphs.map((p, i) => [p.pid, { p, i }]))
  const owned = input.edits?.owned ?? {}
  const out: { cue: SceneCue; i: number }[] = []
  const withSound = (cue: Omit<SceneCue, 'soundId' | 'sound' | 'retake'>, seconds?: number): SceneCue => {
    const s = input.sound(cue.kind, cue.description, seconds)
    return { ...cue, soundId: s?.id ?? '', sound: s?.state ?? 'waiting', retake: s?.retake ?? null }
  }
  const untilOf = (start: CueAnchor, u: CueAnchor | null | undefined, hash?: string): CueAnchor | null => {
    if (!u) return null
    const at = byPid.get(u.pid)
    if (!at) return null
    const kept = u.pid === start.pid || (hash !== undefined && hash === textHash(at.p.text))
    const found = kept ? { anchor: u, placed: true } : relocate(at.p.text, u)
    if (!found.placed && u.pid !== start.pid) return null
    return found.anchor
  }
  for (const [pid, cues] of input.ai) {
    const at = byPid.get(pid)
    if (!at || pid in owned) continue
    for (const c of cues) {
      out.push({
        i: at.i,
        cue: withSound({
          id: c.id,
          kind: c.kind,
          description: c.description,
          at: c.at,
          ...(c.kind === 'ambience' ? { until: untilOf(c.at, c.until, c.untilHash) } : {}),
          origin: 'ai',
          placed: true
        }, c.seconds)
      })
    }
  }
  for (const [pid, cues] of Object.entries(owned)) {
    const at = byPid.get(pid)
    if (!at) continue
    for (const c of cues) {
      const { anchor, placed } = relocate(at.p.text, c.at)
      const u = c.kind === 'ambience' && c.until && byPid.has(c.until.pid) ? relocate(byPid.get(c.until.pid)!.p.text, c.until).anchor : null
      out.push({
        i: at.i,
        cue: withSound({
          id: c.id,
          kind: c.kind,
          description: c.description,
          at: anchor,
          ...(c.kind === 'ambience' ? { until: u } : {}),
          origin: 'adam',
          ...soundLevel(c),
          placed
        })
      })
    }
  }
  return out.sort((a, b) => a.i - b.i || a.cue.at.from - b.cue.at.from).map((x) => x.cue)
}

/** A cue as kept in Adam's edits (no state, no sound: those are looked up as it is read). */
export function keptCue(c: SoundCue): SoundCue {
  return {
    id: c.id,
    kind: c.kind,
    description: c.description,
    soundId: '',
    at: { pid: c.at.pid, from: c.at.from, to: c.at.to, words: c.at.words },
    ...(c.kind === 'ambience' ? { until: c.until ? { pid: c.until.pid, from: c.until.from, to: c.until.to, words: c.until.words } : null } : {}),
    origin: c.origin,
    ...soundLevel(c)
  }
}

/** The softest and loudest a sound can be set, beside the others. */
export const MIN_VOLUME = 0.25
export const MAX_VOLUME = 2

/** A volume as kept: between the softest and loudest, rounded; 1 (as made) when it isn't a number. */
export function cleanVolume(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1
  return Math.round(Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, n)) * 100) / 100
}

/** A cue's volume and mute, kept only when they differ from as made. */
function soundLevel(c: Pick<SoundCue, 'volume' | 'muted'>): Pick<SoundCue, 'volume' | 'muted'> {
  const volume = cleanVolume(c.volume)
  return { ...(volume !== 1 ? { volume } : {}), ...(c.muted === true ? { muted: true } : {}) }
}

// ---------- When each sound is heard ----------

/** A place in the scene: the paragraph's number in it, and a place in its words. */
type Pos = [number, number]
const before = (a: Pos, b: Pos): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])

interface Edge {
  pos: Pos
  pid: string
  at: number
  cue: SceneCue
  edge: ClipSound['edge']
  /** False for an ambience's end that another ambience had already replaced. */
  live: boolean
}

const EDGE_ORDER: Record<ClipSound['edge'], number> = { end: 0, start: 1, fire: 2 }

/** Every effect, ambience start and ambience end in the scene, in order; one ambience at a time. */
function edgesOf(cues: readonly SceneCue[], paragraphs: readonly Paragraph[]): Edge[] {
  const index = new Map(paragraphs.map((p, i) => [p.pid, i]))
  const edges: Edge[] = []
  for (const cue of cues) {
    const i = index.get(cue.at.pid)
    if (i === undefined) continue
    const pos: Pos = [i, cue.at.from]
    edges.push({ pos, pid: cue.at.pid, at: cue.at.from, cue, edge: cue.kind === 'effect' ? 'fire' : 'start', live: true })
    if (cue.kind !== 'ambience' || !cue.until) continue
    const j = index.get(cue.until.pid)
    const end: Pos | null = j === undefined ? null : [j, cue.until.from]
    if (end && before(pos, end)) edges.push({ pos: end, pid: cue.until.pid, at: cue.until.from, cue, edge: 'end', live: true })
  }
  edges.sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || EDGE_ORDER[a.edge] - EDGE_ORDER[b.edge])
  let playing: string | null = null
  for (const e of edges) {
    if (e.edge === 'start') playing = e.cue.id
    else if (e.edge === 'end') {
      e.live = playing === e.cue.id
      if (e.live) playing = null
    }
  }
  return edges.filter((e) => e.live)
}

/** The ambience playing just before a place (null for none). */
function inForce(edges: readonly Edge[], pos: Pos): SceneCue | null {
  let playing: SceneCue | null = null
  for (const e of edges) {
    if (!before(e.pos, pos)) break
    if (e.edge === 'start') playing = e.cue
    else if (e.edge === 'end') playing = null
  }
  return playing
}

/** The ambience playing as the words at `at` in paragraph `pid` are reached, or null. */
export function ambienceAt(cues: readonly SceneCue[], paragraphs: readonly Paragraph[], pid: string, at: number): SceneCue | null {
  const i = paragraphs.findIndex((p) => p.pid === pid)
  if (i < 0) return null
  return inForce(edgesOf(cues, paragraphs), [i, at])
}

/** The sounds that play: muted ones are left out. */
const audible = (cues: readonly SceneCue[]): SceneCue[] => cues.filter((c) => !c.muted)

/** What plays: a sound that couldn't be made has none (''). */
const playable = (cue: SceneCue): string => (cue.sound === 'failed' ? '' : cue.soundId)

/**
 * A reading's clips with their sounds: each effect, ambience start and ambience end goes on the clip whose paragraph
 * and words [from, to) hold its word (one between clips goes on the next clip, at its start; one before the first
 * clip is before the reading and only counts for what is playing), and each clip's `bed` is the ambience playing as
 * it starts, worked out from the start of the scene.
 */
export function clipSounds(
  clips: readonly PlannedClip[],
  cues: readonly SceneCue[],
  paragraphs: readonly Paragraph[],
  o: { muted?: boolean } = {}
): PlannedClip[] {
  if (!clips.length) return [...clips]
  // The scene's sounds are muted: none play, and no ambience either.
  if (o.muted) {
    return clips.map((c) => {
      const { sounds: _sounds, bedVolume: _bedVolume, ...rest } = c
      return { ...rest, bed: null }
    })
  }
  const index = new Map(paragraphs.map((p, i) => [p.pid, i]))
  // A muted sound is left out altogether: a muted ambience neither starts nor ends anything.
  const edges = edgesOf(audible(cues), paragraphs)
  const startOf = (c: PlannedClip): Pos | null => {
    const i = index.get(c.pid)
    return i === undefined ? null : [i, c.from]
  }
  const sounds = new Map<PlannedClip, ClipSound[]>()
  const first = clips.map(startOf).find((p): p is Pos => !!p)
  for (const e of edges) {
    if (!first || before(e.pos, first)) continue
    let on = clips.find((c) => c.pid === e.pid && c.from <= e.at && e.at < c.to)
    let at = e.at
    if (!on) {
      on = clips.find((c) => {
        const s = startOf(c)
        return !!s && before(e.pos, s)
      })
      if (!on) continue
      at = on.from
    }
    const list = sounds.get(on) ?? sounds.set(on, []).get(on)!
    list.push({ cueId: e.cue.id, soundId: playable(e.cue), edge: e.edge, volume: e.cue.volume ?? 1, at })
  }
  return clips.map((c) => {
    const s = startOf(c)
    const bed = s ? inForce(edges, s) : null
    const mine = sounds.get(c) ?? []
    const bedId = bed ? playable(bed) || null : null
    return {
      ...c,
      bed: bedId,
      ...(bedId ? { bedVolume: bed!.volume ?? 1 } : {}),
      sounds: mine.sort((a, b) => a.at - b.at || EDGE_ORDER[a.edge] - EDGE_ORDER[b.edge])
    }
  })
}

/**
 * The sounds a reading reaches, in the order it reaches them from a place (the ambience playing there first): the
 * order they should be made in.
 */
export function soundsAhead(cues: readonly SceneCue[], paragraphs: readonly Paragraph[], pid: string, at: number): SceneCue[] {
  const i = paragraphs.findIndex((p) => p.pid === pid)
  if (i < 0) return []
  const edges = edgesOf(audible(cues), paragraphs)
  const here: Pos = [i, at]
  const out: SceneCue[] = []
  const playing = inForce(edges, here)
  if (playing) out.push(playing)
  for (const e of edges) if (e.edge !== 'end' && !before(e.pos, here) && !out.includes(e.cue)) out.push(e.cue)
  return out
}
