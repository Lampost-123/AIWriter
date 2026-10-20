// Directed writing's stretches (Adam's spec, "Directed writing (an option)", 2026-10-19). The writer writes one stretch at
// a time: one beat of the scene plan, or about 250 words, and pauses at the end of a paragraph (or, cut short by its reply
// limit, of a sentence) so the director can read it. Here: how a draft is cut into stretches (planStretches), how a
// stretch's words are stopped cleanly as they stream (StretchCutter), and the writer's requests (stretchMessages and
// stretchAsk): the briefing exactly as it was built, so a provider's prompt cache covers it from one stretch to the next,
// then the draft so far as the writer's own words, then the stretch asked for with the director's note, last. Pure.

import type { ChatMessage } from '@shared/types'
import { AUTO_LENGTH, countWords } from '@shared/defaults'
import { TOKENS_PER_WORD } from '../ai/context'

/** About how long a stretch is when the plan gives no beats. */
export const STRETCH_WORDS = 250
/** The fewest and most words one stretch is asked for: a beat this short is written with the next one. */
export const LEAST_STRETCH_WORDS = 120
export const MOST_STRETCH_WORDS = 450
/** The most stretches a scene is written in, retakes not counted (the spec's limit). */
export const MOST_STRETCHES = 12
/** The most times one paragraph is taken again (the spec's limit). */
export const MOST_RETAKES = 2
/** A stretch stops at the first paragraph's end past this share of the words it was asked for. */
export const STOP_AT = 1.15
/** Past this share of its words, a stretch holds back a sentence until it ends, so one cut short never reaches the page. */
export const HOLD_AT = 0.9
/** Reply room for a stretch: its words in tokens, this many times over (a stretch that runs on stops before it). */
export const STRETCH_ROOM = 1.7

/** One stretch of the plan: the beats it writes (none: just what comes next) and about how many words. */
export interface StretchUnit {
  beats: string[]
  words: number
}

export interface StretchPlan {
  units: StretchUnit[]
  /** The words the whole draft aims for. */
  target: number
  /** Every beat, in order, for telling which are on the page. */
  beats: string[]
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/**
 * Cuts a draft into stretches. With beats (the scene plan's, else the card's): one beat a stretch, short beats written
 * together and never more than MOST_STRETCHES; without: about STRETCH_WORDS each. `targetWords` null is Auto: about 280
 * words a beat, within Auto's bounds (AUTO_LENGTH), or a typical scene's length with no beats.
 */
export function planStretches(beatsIn: readonly string[], targetWords: number | null): StretchPlan {
  const beats = beatsIn.map(clean).filter(Boolean)
  const target = Math.round(
    targetWords && targetWords > 0
      ? targetWords
      : beats.length
        ? clamp(beats.length * 280, AUTO_LENGTH.min, AUTO_LENGTH.typical)
        : AUTO_LENGTH.typical
  )
  if (!beats.length) {
    const n = clamp(Math.round(target / STRETCH_WORDS), 1, MOST_STRETCHES)
    const words = Math.round(target / n)
    return { units: Array.from({ length: n }, () => ({ beats: [], words })), target, beats }
  }
  // How many stretches: one a beat, fewer when the beats are short for the length, never more than the most.
  const n = clamp(Math.min(beats.length, Math.floor(target / LEAST_STRETCH_WORDS)), 1, MOST_STRETCHES)
  const units: StretchUnit[] = []
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * beats.length) / n)
    const to = Math.floor(((i + 1) * beats.length) / n)
    units.push({ beats: beats.slice(from, to), words: 0 })
  }
  const each = Math.round(target / n)
  for (const u of units) u.words = clamp(each, LEAST_STRETCH_WORDS, MOST_STRETCH_WORDS)
  return { units, target, beats }
}

/** Reply room for a stretch of `words` words, in tokens. */
export const stretchTokens = (words: number): number => Math.ceil(words * TOKENS_PER_WORD * STRETCH_ROOM) + 40

// ---------- Stopping cleanly ----------

/** A sentence's end: its mark, any closing quote or bracket, then a space (or, once the words are all in, the end). */
const SENTENCE_END = /[.!?…](?:["”’')\]*_]*)(?=\s)/g
const SENTENCE_END_LAST = /[.!?…](?:["”’')\]*_]*)(?=\s|$)/g

/**
 * Where the last whole sentence of `text` ends (0 when none has). `ended`: no more words are coming, so a mark at the
 * very end ends a sentence too (while they stream, a closing quote may still follow it).
 */
export function lastSentenceEnd(text: string, ended = false): number {
  let at = 0
  for (const m of text.matchAll(ended ? SENTENCE_END_LAST : SENTENCE_END)) at = (m.index ?? 0) + m[0].length
  return at
}

/**
 * Watches one stretch's words as they stream and says what may go to the page now. Up to `holdAt` words everything
 * goes at once; past it, a sentence still being written is held back until it ends; at the first paragraph's end past
 * `stopAt` words the stretch stops (what follows the break never goes). When the stream ends at the reply limit, a
 * sentence it left unfinished is dropped, so the page never shows half a sentence.
 */
export class StretchCutter {
  /** Everything taken in, less anything after a stop. */
  private text = ''
  /** How much of it has gone out. */
  private given = 0
  stopped = false

  constructor(private readonly o: { stopAt: number; holdAt: number }) {}

  push(raw: string): { out: string; stop: boolean } {
    if (this.stopped || !raw) return { out: '', stop: this.stopped }
    const start = this.text.length
    this.text += raw
    // A paragraph's end past the stop: the stretch ends there.
    const breakRe = /\n/g
    breakRe.lastIndex = Math.max(0, start - 1)
    for (let m = breakRe.exec(this.text); m; m = breakRe.exec(this.text)) {
      const before = this.text.slice(0, m.index)
      if (countWords(before) >= this.o.stopAt && before.trim()) {
        this.text = before.replace(/\s+$/, '')
        this.stopped = true
        return { out: this.release(this.text.length), stop: true }
      }
    }
    if (countWords(this.text) < this.o.holdAt) return { out: this.release(this.text.length), stop: false }
    return { out: this.release(Math.max(this.given, lastSentenceEnd(this.text))), stop: false }
  }

  /** The stream ended. `cutOff`: it ran into the reply limit, so a sentence left unfinished goes. What is left to give out. */
  end(cutOff: boolean): string {
    if (cutOff && !this.stopped) {
      const at = lastSentenceEnd(this.text, true)
      if (at > 0) this.text = this.text.slice(0, Math.max(at, this.given))
    }
    this.stopped = true
    return this.release(this.text.length)
  }

  /** The stretch's words as kept. */
  kept(): string {
    return this.text.slice(0, Math.max(this.given, 0))
  }

  private release(to: number): string {
    if (to <= this.given) return ''
    const out = this.text.slice(this.given, to)
    this.given = to
    return out
  }
}

// ---------- Paragraphs ----------

/** The draft's last paragraph (paragraphs are split on any line break, as the page splits them), or '' for none. */
export function lastParagraph(text: string): string {
  const t = text.replace(/\s+$/, '')
  const at = t.search(/\n[^\n]*$/)
  return at < 0 ? t : t.slice(at + 1)
}

// ---------- The writer's requests ----------

/**
 * A stretch's request: the briefing's own messages untouched (its start is what the provider's cache keeps), then, once
 * the draft has words, those words as the writer's own and the ask as a new message; before that, the ask after the
 * briefing's closing words in the same message.
 */
export function stretchMessages(base: readonly ChatMessage[], soFar: string, ask: string): ChatMessage[] {
  const words = soFar.replace(/\s+$/, '')
  if (words.trim()) return [...base, { role: 'assistant', content: words }, { role: 'user', content: ask }]
  const last = base[base.length - 1]
  if (!last || last.role !== 'user') return [...base, { role: 'user', content: ask }]
  return [...base.slice(0, -1), { ...last, content: `${last.content}\n\n${ask}` }]
}

/** What a stretch is asked to write. */
export interface StretchAsk {
  /** From 1, and how many the scene is planned in. */
  stretch: number
  of: number
  unit: StretchUnit
  /** The director's note for this stretch; '' for none. */
  note: string
  /** Adam's own notes, given while it wrote, as he wrote them. */
  adam: string[]
  /** The plan's last stretch, or one past it: the scene ends here. */
  last: boolean
  /** The image the scene ends on ('' when the plan gives none). */
  closing: string
  /** The draft has no words yet: this request carries the ask after the briefing's own closing words. */
  first: boolean
  /** Taking the last paragraph again: the paragraph as it was, and what is wrong with it. */
  retake?: { paragraph: string; reason: string }
}

const quoted = (s: string): string => `“${clean(s).replace(/^[“"]|[”"]$/g, '')}”`
const asSentence = (s: string): string => {
  const t = clean(s)
  return /[.!?…]["”’]?$/.test(t) ? t : `${t}.`
}

/** The notes a stretch is given, director's first: one line each. */
function notesText(a: Pick<StretchAsk, 'note' | 'adam'>): string {
  return [
    ...a.adam.map((n) => `The author’s note, just now: ${quoted(n)} Take it from here.`),
    a.note.trim() ? `Director’s note: ${asSentence(a.note)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** What the stretch writes: its beats, or what comes next. */
function whatText(u: StretchUnit): string {
  if (!u.beats.length) return 'what comes next'
  return u.beats.map((b, i) => (i === 0 ? quoted(asSentence(b)) : `then ${quoted(asSentence(b))}`)).join(', ')
}

/** The ask for one stretch, or for its last paragraph again, in the writer's plain words. */
export function stretchAsk(a: StretchAsk): string {
  const notes = notesText(a)
  if (a.retake) {
    return [
      'Take your last paragraph again. It read:',
      quoted(a.retake.paragraph),
      `What’s wrong: ${asSentence(a.retake.reason)}`,
      notes,
      'Write that paragraph anew in its place, carrying on from the end of the paragraph before it: one paragraph only, then stop.'
    ]
      .filter(Boolean)
      .join('\n')
  }
  const length = `about ${a.unit.words} words`
  const ending = a.last
    ? a.closing.trim()
      ? ` This is the last stretch: end the scene on its closing image, ${quoted(asSentence(a.closing))}`
      : ' This is the last stretch: bring the scene to its end.'
    : ' End at the end of a paragraph once that has happened, and stop there: the next stretch carries on from it.'
  if (a.first) {
    return [
      `Directed writing: you write this a stretch at a time, and a director reads each stretch and gives you a short note before the next. Write only stretch ${a.stretch} of ${a.of} now, ${length}: ${whatText(a.unit)}.${ending}`,
      notes
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    notes,
    `Carry on from the very end of what you have written above, without saying any of it again. Write stretch ${a.stretch} of ${a.of}, ${length}: ${whatText(a.unit)}.${ending}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The words of a draft in a stretch's count (the same count the page uses). */
export const wordsIn = (text: string): number => countWords(text)
