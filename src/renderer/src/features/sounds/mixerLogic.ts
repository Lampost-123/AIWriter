// The sound effects mixer's decisions, kept pure so they are tested without a browser (mixer.ts plays them): how
// loud the sounds are for the volume Adam sets, how far they dip under the voice, which ambience plays after a jump
// or an edge, when each of a clip's sounds is due as the voice plays, and which decoded sounds are kept.
import type { ClipSound } from '@shared/contracts/readAloud'

/** Effects playing at once; one more lets the oldest go. */
export const MAX_EFFECTS = 3
/** Decoded sounds kept in the window (the oldest used is let go first). */
export const KEEP_SOUNDS = 30

/** Fades, in seconds. */
export const BED_FADE_IN = 1.5
export const BED_CROSSFADE = 1.5
export const BED_FADE_OUT = 2
export const STOP_FADE = 0.3
export const EFFECT_FADE_IN = 0.01
/** How quickly the sounds dip under a line and come back in the breath after it. */
export const DUCK_RAMP = 0.25
/** How far they dip while a line is spoken. */
export const BED_DUCK_DB = -8
export const EFFECT_DUCK_DB = -3
/** A sound due within this many seconds is handed to the audio clock now, so it lands on its word exactly. */
export const LEAD = 0.06
/** Listen in the Sounds view plays an ambience this long, then fades it out. */
export const PREVIEW_BED_SECONDS = 8

export const dbToGain = (db: number): number => 10 ** (db / 20)

/**
 * The sounds' loudness for the volume Adam sets (0 to 1), on a curve the ear hears as even steps: about −4 dB at the
 * top, −19 dB at the middle (the default, well under the voice), fading to silence at the bottom. The clips arrive
 * loudness-matched, so this is the whole of their level.
 */
export function volumeGain(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0
  const v = Math.min(1, volume)
  return dbToGain(-34 + 30 * v) * Math.min(1, v / 0.05)
}

/** What happens to the ambience when reading wants another: nothing, start one, cross to another, or fade it out. */
export type BedChange = 'keep' | 'start' | 'crossfade' | 'stop'

/** `wanted`: a library sound, or null/'' for none (a sound not chosen yet plays nothing). */
export function bedChange(playing: string | null, wanted: string | null | undefined): BedChange {
  const w = wanted || null
  if (w === playing) return 'keep'
  if (!w) return 'stop'
  return playing ? 'crossfade' : 'start'
}

/**
 * The ambience after one of a clip's edges: a 'start' puts its sound on (one plays at a time, so it takes the place
 * of any other); an 'end' fades out the ambience it ends, and only that one. Undefined: no change.
 */
export function bedAfterEdge(playing: string | null, edge: Pick<ClipSound, 'edge' | 'soundId'>): string | null | undefined {
  if (edge.edge === 'start') return edge.soundId || null
  if (edge.edge === 'end') return edge.soundId && playing === edge.soundId ? null : undefined
  return undefined
}

/**
 * Where each sound falls in a clip by the share of its words before it: the estimate used until the speech server
 * says when the words are heard. `duration` in seconds of the clip's audio.
 */
export function estimateTimes(clip: { from: number; to: number }, at: readonly number[], duration: number): number[] {
  const span = clip.to - clip.from
  return at.map((a) => (span > 0 && duration > 0 ? Math.min(1, Math.max(0, (a - clip.from) / span)) * duration : 0))
}

export interface EdgeTiming {
  /** When it is heard, in seconds of the clip's audio (not of the clock: speed changes nothing here); null: not known yet. */
  at: number | null
  done: boolean
}

/**
 * The edges due now: those heard within LEAD of the clip's place (`now`, in its audio's seconds), each with how long
 * to wait on the clock at this speed. The clip's own time is the measure, so it stays right at any speed and across a
 * pause.
 */
export function dueEdges(edges: readonly EdgeTiming[], now: number, rate: number, lead = LEAD): { index: number; delay: number }[] {
  const r = rate > 0 && Number.isFinite(rate) ? rate : 1
  const out: { index: number; delay: number }[] = []
  edges.forEach((e, index) => {
    if (e.done || e.at == null) return
    const delay = (e.at - now) / r
    if (delay <= lead) out.push({ index, delay: Math.max(0, delay) })
  })
  return out
}

/** The edges still to come when a clip has played to its end (heard a moment late rather than not at all). */
export const leftAtEnd = (edges: readonly EdgeTiming[]): number[] => edges.flatMap((e, i) => (e.done ? [] : [i]))

/** How many of the effects playing to let go so one more can start. */
export const effectsToDrop = (playing: number, max = MAX_EFFECTS): number => Math.max(0, playing + 1 - max)

/** A small least-recently-used store: the oldest used is let go once it holds more than `max`. */
export class Lru<K, V> {
  private readonly map = new Map<K, V>()
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  set(key: K, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K
      this.map.delete(oldest)
    }
  }

  delete(key: K): void {
    this.map.delete(key)
  }

  get size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }
}
