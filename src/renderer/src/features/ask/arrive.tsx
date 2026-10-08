// An answer's words arriving (Ask the world on the desk, UI overhaul): like the lamp's words in the page
// (features/editor/arrival.ts), each new stretch fades in (opacity only, 160ms; the words never move). The stretches are
// counted in the answer's words as shown (names without their brackets), each with when it came; one older than 200ms
// has played out and joins the plain words again. With less motion, or off the desk, nothing fades.
import { useRef, type ReactNode } from 'react'
import type { AnswerPart } from './citations'

export interface Arrival {
  from: number
  to: number
  at: number
}

const PLAYED_MS = 200

/** How many characters the parts show. */
export const shownLength = (parts: AnswerPart[]): number => parts.reduce((n, p) => n + p.text.length, 0)

/**
 * The stretches still arriving, given how long the answer's shown words are now. `live` off (not being written, or no
 * fading wanted): none, and what is there counts as already arrived.
 */
export function useArrivals(length: number, live: boolean): Arrival[] {
  const seen = useRef<number | null>(null)
  const list = useRef<Arrival[]>([])
  const now = performance.now()
  if (!live) {
    seen.current = length
    list.current = []
    return list.current
  }
  // The first words of an answer arrive too (from nothing).
  if (seen.current === null) seen.current = 0
  if (length > seen.current) {
    list.current = [...list.current, { from: seen.current, to: length, at: now }]
    seen.current = length
  } else if (length < seen.current) {
    // The words were tidied shorter (a mark turned into italics): start again from here.
    seen.current = length
    list.current = []
  }
  list.current = list.current.filter((a) => now - a.at < PLAYED_MS)
  return list.current
}

/** A run of words starting at `start` in the answer: the stretches still arriving in it wrapped to fade in. */
export function fadeText(text: string, start: number, arrivals: Arrival[]): ReactNode {
  if (!arrivals.length) return text
  const end = start + text.length
  const out: ReactNode[] = []
  let at = start
  for (const a of arrivals) {
    const from = Math.max(a.from, start)
    const to = Math.min(a.to, end)
    if (to <= from) continue
    if (from > at) out.push(text.slice(at - start, from - start))
    out.push(
      <span key={`a${a.from}-${from}`} className="ask-arrive">
        {text.slice(from - start, to - start)}
      </span>
    )
    at = to
  }
  if (at < end) out.push(text.slice(at - start))
  return out.length === 1 ? out[0] : out
}
