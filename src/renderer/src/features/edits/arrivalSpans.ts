// Continue's new words fading in as they arrive (the New look; the lamp, features/editor/arrival.ts, does the same for
// a draft written into the page). A change's new words are a widget drawn again whenever they change
// (suggestions.ts, renderNew), so a word still fading when the next chunk comes would otherwise start its fade again,
// or pop to full strength. This keeps, for the change being written, how many characters showed and when, and says
// which stretch of the words is still fading and how far along: a CSS animation-delay of minus the time since those
// words arrived carries each fade on from where it was. Pure, so it can be tested without a page.

/** How long a word takes to fade in (the `aw-arrive` keyframes run this long). */
export const ARRIVE_MS = 160

/** A stretch of the new words, by character offsets into them, still fading in: `delay` is ≤ 0 (ms). */
export interface ArrivalSpan {
  from: number
  to: number
  delay: number
}

/** A piece of text, and its fade's delay if it is still fading (null: shown in full). */
export interface ArrivalRun {
  text: string
  delay: number | null
}

export class ArrivalSpans {
  private id: string | null = null
  /** How many characters showed at each time, in order; the first may be long done (it is where the fading starts). */
  private marks: { len: number; at: number }[] = []

  /**
   * The change `id` shows `len` characters of new words at `now`. Words that are new since it last showed fade in
   * when `fade` is true (it is being written), else show at once. Returns the stretches still fading. One change at a
   * time: another id starts afresh.
   */
  note(id: string, len: number, now: number, fade = true): ArrivalSpan[] {
    if (id !== this.id) {
      this.id = id
      this.marks = []
    }
    // Asterisks turned into italics take a character or two away: what showed before is cut to fit.
    for (const m of this.marks) if (m.len > len) m.len = len
    const last = this.marks[this.marks.length - 1]
    if (!last || len > last.len) this.marks.push({ len, at: fade ? now : -Infinity })
    // Keep from the mark just before the first one still fading (where the fading stretches start), or only the last.
    const young = this.marks.findIndex((m) => now - m.at < ARRIVE_MS)
    if (young === -1) this.marks = this.marks.slice(-1)
    else if (young > 1) this.marks = this.marks.slice(young - 1)
    const out: ArrivalSpan[] = []
    let prev = 0
    for (const m of this.marks) {
      if (m.len > prev && now - m.at < ARRIVE_MS) out.push({ from: prev, to: m.len, delay: Math.min(0, m.at - now) })
      prev = Math.max(prev, m.len)
    }
    return out
  }

  /** Forgets the change (it was accepted, rejected or went). */
  forget(): void {
    this.id = null
    this.marks = []
  }
}

/** Splits a piece of the new words, starting `offset` characters into them, into what is still fading and what isn't. */
export function runsOf(text: string, offset: number, spans: ArrivalSpan[]): ArrivalRun[] {
  const end = offset + text.length
  const out: ArrivalRun[] = []
  let at = offset
  for (const s of spans) {
    if (s.to <= at || s.from >= end) continue
    const from = Math.max(s.from, at)
    if (from > at) out.push({ text: text.slice(at - offset, from - offset), delay: null })
    const to = Math.min(s.to, end)
    out.push({ text: text.slice(from - offset, to - offset), delay: s.delay })
    at = to
  }
  if (at < end) out.push({ text: text.slice(at - offset), delay: null })
  return out.filter((r) => r.text)
}
