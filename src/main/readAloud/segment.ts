// Adapted from mcreader-v2, src/lib/speech/speech.ts (its splitting: roughPieces, cutLong, roleSpans, pack,
// segmentText, quickStart, restBetween, stressed and sameMood; reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026).
//
// Splitting a paragraph into the clips the voice speaks. Sentences are packed into clips of a workable length
// (Breeze pays a fixed cost per clip and reads better with a few sentences to shape), never mixing the narrator
// with a quote; a long sentence is cut at a comma. Every piece keeps where it is in its paragraph, so the page can
// highlight the sentence being read. A reading's first clip is a single sentence, so the sound starts quickly.
import { canonicalTag } from './perform'
import { QUOTE, SENTENCE } from './speakers'
import type { LineDelivery } from './types'

/** How long a clip may be, and how short one has to be before the next sentence joins it. */
export const CLIP_MAX = 420
export const CLIP_MIN = 200
/** A sentence this short, read as a clip of its own, is the one most likely to come out off-voice. */
export const SHORT_CLIP = 40

/** Silence between paragraphs, and where the voice changes inside one: a reader breathes there. */
export const PARAGRAPH_REST_MS = 450
export const TURN_REST_MS = 120

/** `mood`: the note on the narration a piece is in (its tone and pace), which a clip keeps to one of. */
interface Piece {
  text: string
  at: number
  role?: 'narrator' | 'other'
  quote?: { at: number; len: number }
  mood?: string
}

/** One clip's stretch of a paragraph. */
export interface Utterance {
  pid: string
  /** The paragraph's words. */
  para: string
  /** [from, to) in the paragraph, without the spaces around it. */
  from: number
  to: number
  role: 'narrator' | 'other'
  /** The whole quote it is part of (a quote of several sentences can be read in several clips). */
  quote?: { at: number; len: number }
}

/** A note on a sentence of narration: where the sentence is, and how it is read. */
export interface NarrationNote {
  at: number
  end: number
  how?: LineDelivery
}

/**
 * Sentence-ish chunks: punctuation that ends one, then whatever is left. Each includes the whitespace in front of
 * it, so the pieces of a paragraph are contiguous and a clip of two sentences can be sliced out at exactly the
 * right places.
 */
function roughPieces(text: string): Piece[] {
  const out: Piece[] = []
  const re = new RegExp(SENTENCE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ text: m[0], at: m.index })
  return out
}

/** Cuts at a dash, semicolon, colon or comma near the middle, so no clip is unwieldy. */
function cutLong(piece: Piece): Piece[] {
  if (piece.text.length <= CLIP_MAX) return [piece]
  const window = piece.text.slice(0, CLIP_MAX)
  const floor = Math.floor(CLIP_MAX / 3)
  let cut = -1
  for (const mark of ['—', '–', ';', ':', ',', ' ']) {
    const at = window.lastIndexOf(mark)
    if (at > floor) {
      cut = at + (mark === ' ' ? 0 : 1)
      break
    }
  }
  if (cut <= 0) cut = CLIP_MAX
  const head = piece.text.slice(0, cut)
  const tail = piece.text.slice(cut)
  return [{ text: head, at: piece.at }, ...cutLong({ text: tail, at: piece.at + cut })]
}

/**
 * Narration and quotes, in order. Each quote is whole, however many sentences it has. A quote with no closing mark
 * runs to the end of its paragraph, the way a speech that carries on into the next paragraph is written.
 */
function roleSpans(text: string): Piece[] {
  const out: Piece[] = []
  const re = new RegExp(QUOTE.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), at: last, role: 'narrator' })
    out.push({ text: m[0], at: m.index, role: 'other', quote: { at: m.index, len: m[0].length } })
    last = m.index + m[0].length
    if (!m[0].length) re.lastIndex++
  }
  if (last < text.length) out.push({ text: text.slice(last), at: last, role: 'narrator' })
  return out
}

/**
 * Packs consecutive sentences into clips of a workable length. Same voice only: a quote never joins the narrator,
 * nor another quote. Narration may change mood once inside a clip (a second change starts a new clip, unless the
 * sentence is short: on its own, a short sentence tends to come out off the narrator's voice).
 */
function pack(pieces: Piece[]): Piece[] {
  const out: (Piece & { turned?: number })[] = []
  for (const p of pieces) {
    const last = out.at(-1)
    const voice = (last?.role ?? 'narrator') === (p.role ?? 'narrator') && last?.quote?.at === p.quote?.at
    const turn = last?.mood !== p.mood
    // Only from one note to another: narration with none is read plain, a different kind of clip.
    const room = (last?.turned ?? 0) < (p.text.trim().length <= SHORT_CLIP ? 2 : 1)
    const turns = turn && room && !!last?.mood && !!p.mood
    if (voice && (!turn || turns) && last && last.text.trim().length < CLIP_MIN && last.text.length + p.text.length <= CLIP_MAX) {
      last.text += p.text
      if (turn) Object.assign(last, { mood: p.mood, turned: (last.turned ?? 0) + 1 })
    } else {
      out.push({ ...p })
    }
  }
  return out
}

/** Words that say little about a mood, left out when two notes are compared. */
const FILLER = new Set([
  'and',
  'but',
  'the',
  'its',
  'his',
  'her',
  'their',
  'with',
  'into',
  'from',
  'still',
  'very',
  'voice',
  'tone',
  'read',
  'reads',
  'now',
  'more',
  'little',
  'slightly'
])
const moodWords = (tone = ''): Set<string> => new Set((tone.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !FILLER.has(w)))

/**
 * Whether two notes on narration are one mood: the same pace, and more than half the same words ("hushed, dread
 * building" and "hushed, the dread still rising"). A mood that carries on is often reworded; read as a turn each
 * time, it would break the narration into a clip every sentence or two.
 */
export function sameMood(a: LineDelivery, b: LineDelivery): boolean {
  if ((a.pace ?? '') !== (b.pace ?? '')) return false
  const x = moodWords(a.tone)
  const y = moodWords(b.tone)
  if (!x.size || !y.size) return (a.tone ?? '').trim().toLowerCase() === (b.tone ?? '').trim().toLowerCase()
  return (2 * [...x].filter((w) => y.has(w)).length) / (x.size + y.size) > 0.5
}

/**
 * A paragraph split into the clips that will be spoken, from `start` (characters into it) to its end. `notes`: the
 * marks on its sentences of narration, so a clip keeps to one mood (or one turn between two).
 */
export function segmentParagraph(pid: string, text: string, start = 0, notes: NarrationNote[] = []): Utterance[] {
  const raw: Piece[] = []
  for (const span of roleSpans(text)) {
    for (const p of roughPieces(span.text)) {
      for (const q of cutLong({ text: p.text, at: span.at + p.at })) raw.push({ ...q, role: span.role, quote: span.quote })
    }
  }
  const told = notes.filter((x) => x.how?.tone || x.how?.pace)
  let mood = ''
  let note: LineDelivery | undefined
  for (const p of told.length ? raw : []) {
    if (p.role === 'other') continue
    const own = told.find((x) => x.at === p.at + p.text.length - p.text.trimStart().length)?.how
    if (own && !(note && sameMood(note, own))) {
      note = own
      mood = `${own.tone ?? ''}|${own.pace ?? ''}`
    }
    p.mood = mood
  }
  // From `start` on: pieces before it are dropped, and the one it falls in starts there.
  const kept = raw
    .filter((p) => p.at + p.text.length > start)
    .map((p) => (p.at < start ? { ...p, text: p.text.slice(start - p.at), at: start } : p))
  const out: Utterance[] = []
  for (const q of pack(kept)) {
    const body = q.text.trim()
    if (!body) continue
    const from = q.at + (q.text.length - q.text.trimStart().length)
    out.push({ pid, para: text, from, to: from + body.length, role: q.role ?? 'narrator', ...(q.quote ? { quote: q.quote } : {}) })
  }
  return out
}

/** The sentences of a clip, [from, to) each in its paragraph, without the spaces around them. */
export function sentencesOf(u: Pick<Utterance, 'para' | 'from' | 'to'>): [number, number][] {
  const out: [number, number][] = []
  const slice = u.para.slice(u.from, u.to)
  for (const m of slice.matchAll(new RegExp(SENTENCE.source, 'g'))) {
    const body = m[0].trim()
    if (!body) continue
    const from = u.from + m.index! + (m[0].length - m[0].trimStart().length)
    out.push([from, from + body.length])
  }
  return out.length ? out : [[u.from, u.to]]
}

/**
 * The first clip of a reading cut down to its first sentence, when it has more than one, so the first words come
 * as soon as one sentence is made; the rest is made while it plays. A very short first sentence keeps its company,
 * since on its own it tends to come out off the voice.
 */
export function quickStart(items: Utterance[]): Utterance[] {
  const [head, ...rest] = items
  if (!head) return items
  const sentences = sentencesOf(head)
  if (sentences.length < 2) return items
  const [first] = sentences
  if (first[1] - first[0] <= SHORT_CLIP) return items
  const next = sentences[1][0]
  return [{ ...head, to: first[1] }, { ...head, from: next }, ...rest]
}

/**
 * How long to wait between two clips: clips of one paragraph follow straight on, as the sentences of a speech do;
 * a new paragraph, or a turn from the narrator to a line of dialogue, gets a breath.
 */
export function restBetween(a: Utterance, b: Utterance | undefined): number {
  if (!b) return 0
  if (a.pid !== b.pid) return PARAGRAPH_REST_MS
  return a.role !== b.role || a.quote?.at !== b.quote?.at ? TURN_REST_MS : 0
}

/**
 * The words set in italics for stress inside a clip, up to three words each and three in all: the emphasis the page
 * shows. A written sound in italics ("sighs") is a sound, not a stress, and a longer italic run is a thought or a
 * title.
 */
export function stressed(para: string, italics: [number, number][] | undefined, from: number, to: number): string[] {
  const out: string[] = []
  for (const [a, b] of italics ?? []) {
    if (b <= from || a >= to) continue
    const words = para
      .slice(Math.max(a, from), Math.min(b, to))
      .trim()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (!words || words.split(/\s+/).length > 3 || canonicalTag(words)) continue
    if (!out.includes(words)) out.push(words)
  }
  return out.slice(0, 3)
}

/** A clip's words with its italic stretches between asterisks, as written sounds (`*sighs*`) are looked for. */
export function withItalics(para: string, italics: [number, number][] | undefined, from: number, to: number): string {
  const cuts = (italics ?? [])
    .map(([a, b]): [number, number] => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let out = ''
  let at = from
  for (const [a, b] of cuts) {
    if (a < at) continue
    out += para.slice(at, a) + `*${para.slice(a, b)}*`
    at = b
  }
  return out + para.slice(at, to)
}
