// The Sounds view's words and places, kept pure so they are tested without a browser: where a sound plays in plain
// words, what its state says, the words Adam selected as a place for a sound, and where a sound's words are on the
// page now.
import type { CueAnchor, SceneCue } from '@shared/contracts/sounds'
import { placeOf, posIn, type PageParagraph } from '@/features/readAloud/pageText'

/** Words shown in quotation marks, cut short past `max` characters (at a word, with "…"). */
export function quote(words: string, max = 36): string {
  const w = words.replace(/\s+/g, ' ').trim()
  if (w.length <= max) return `“${w}”`
  const cut = w.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `“${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.!?—–-]+$/, '')}…”`
}

/**
 * Where a sound plays: "on “slammed”" for an effect; "from “rain” to the end of the scene" or "from “rain” until
 * “stepped inside”" for ambience. A sound whose words changed plays at the nearest place: "near …".
 */
export function whereWords(cue: Pick<SceneCue, 'kind' | 'at' | 'until' | 'placed'>): string {
  const at = quote(cue.at.words)
  if (cue.kind === 'effect') return `${cue.placed ? 'on' : 'near'} ${at}`
  const from = `${cue.placed ? 'from' : 'from near'} ${at}`
  return cue.until ? `${from} until ${quote(cue.until.words)}` : `${from} to the end of the scene`
}

/** What a sound's state says while it can't play yet; '' once it can. */
export function stateWords(cue: Pick<SceneCue, 'sound' | 'soundId'>): string {
  if (cue.sound === 'failed') return 'Couldn’t be made'
  if (cue.sound === 'ready') return ''
  return 'Being made…'
}

/** The words selected on the page as a place for a sound, or why they can't be one. */
export type Picked = { anchor: CueAnchor } | { problem: 'none' | 'paragraphs' }

/** The selection [from, to) as a place in one paragraph's words, without the spaces at its ends. */
export function pickWords(paragraphs: readonly PageParagraph[], from: number, to: number): Picked {
  if (to <= from) return { problem: 'none' }
  const a = placeOf(paragraphs, from)
  const b = placeOf(paragraphs, to)
  if (!a || !b) return { problem: 'none' }
  if (a.index !== b.index) return { problem: 'paragraphs' }
  const p = paragraphs[a.index]
  let s = a.offset
  let e = b.offset
  while (s < e && /\s/.test(p.text[s])) s++
  while (e > s && /\s/.test(p.text[e - 1])) e--
  if (e <= s || !/[\p{L}\p{N}]/u.test(p.text.slice(s, e))) return { problem: 'none' }
  return { anchor: { pid: p.pid, from: s, to: e, words: p.text.slice(s, e) } }
}

/**
 * Where an anchor's words are on the page now: where it says when they are still there, else the nearest place in
 * its paragraph with the same words; null when they are gone.
 */
export function anchorRange(paragraphs: readonly PageParagraph[], anchor: CueAnchor): { from: number; to: number } | null {
  const p = paragraphs.find((x) => x.pid === anchor.pid)
  if (!p || !anchor.words) return null
  let start = -1
  if (p.text.slice(anchor.from, anchor.to) === anchor.words) start = anchor.from
  else {
    let best = Infinity
    for (let i = p.text.indexOf(anchor.words); i >= 0; i = p.text.indexOf(anchor.words, i + 1)) {
      const d = Math.abs(i - anchor.from)
      if (d < best) {
        best = d
        start = i
      }
    }
  }
  if (start < 0) return null
  return { from: posIn(p, start), to: posIn(p, start + anchor.words.length) }
}

/** True when `b` comes after `a` in reading order (an ambience can end only after it starts). */
export function comesAfter(paragraphs: readonly Pick<PageParagraph, 'pid'>[], a: CueAnchor, b: CueAnchor): boolean {
  const i = paragraphs.findIndex((p) => p.pid === a.pid)
  const j = paragraphs.findIndex((p) => p.pid === b.pid)
  if (i < 0 || j < 0) return false
  return j > i || (j === i && b.from >= a.to)
}

/** One stretch of words the page marks faintly while the Sounds view shows. */
export interface SoundWords {
  cueId: string
  kind: SceneCue['kind']
  /** 'at': where it plays (or starts); 'until': where an ambience ends. */
  role: 'at' | 'until'
  anchor: CueAnchor
  /** Adam muted it: marked more faintly. */
  muted?: boolean
}

/** The words each sound is placed on. */
export const soundWords = (cues: readonly SceneCue[]): SoundWords[] =>
  cues.flatMap((c) => [
    { cueId: c.id, kind: c.kind, role: 'at' as const, anchor: c.at, ...(c.muted ? { muted: true } : {}) },
    ...(c.until ? [{ cueId: c.id, kind: c.kind, role: 'until' as const, anchor: c.until, ...(c.muted ? { muted: true } : {}) }] : [])
  ])

/**
 * What else the row says about a sound, after where it plays: muted, its own volume when it isn't as made, and a new
 * take being made ("Muted · 150% volume").
 */
export function soundNotes(cue: Pick<SceneCue, 'muted' | 'volume' | 'retake'>): string[] {
  const out: string[] = []
  if (cue.muted) out.push('Muted')
  if (cue.volume != null && Number.isFinite(cue.volume) && Math.abs(cue.volume - 1) > 0.001) out.push(`${Math.round(cue.volume * 100)}% volume`)
  if (cue.retake === 'making') out.push('Making a new take…')
  return out
}

/** "3 sounds", "1 sound". */
export const countWords = (n: number): string => `${n} ${n === 1 ? 'sound' : 'sounds'}`
