// Is the chapter writer still getting somewhere? The run stops when a round of checking makes no progress: the same
// findings left after two tries at fixing them, or the chapter's words back to a version already checked (the AI going
// round in circles, fixing one thing by undoing another). And it settles (live test, 2026-10-16: 14 rounds, about 280
// changes and 2 hours on one chapter, the critic finding new things to say at every re-read): at most
// CHAPTER_WRITER_LIMITS.fixRounds rounds of fixing, none started after its minutes, and each finding given to the AI at
// most MAX_TRIES times, once only when it is about words the AI wrote itself this run (Tries). Pure.

import { createHash } from 'node:crypto'
import { countWords } from '@shared/defaults'
import type { Emit } from '../ai/tasks'

/** Rounds in a row that find exactly the same things (found, then two tries at fixing them) before the run stops. */
export const SAME_ROUNDS = 3

const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Rounds a finding is given to the AI to fix before it is left for Adam (found, then once more if it comes back). */
export const MAX_TRIES = 2

/** Words as compared: lower case, curly quotes straight, punctuation and italics' asterisks gone. */
export const foldWords = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Runs of this many words in a row count as the same words. */
const RUN = 6

/** True when two passages share words: one inside the other, or a run of RUN words in a row in both. */
export function wordsOverlap(a: string, b: string): boolean {
  const fa = foldWords(a)
  const fb = foldWords(b)
  if (!fa || !fb) return false
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa]
  if (long.includes(short)) return true
  const w = short.split(' ')
  if (w.length < RUN) return false
  const padded = ` ${long} `
  for (let i = 0; i + RUN <= w.length; i++) if (padded.includes(` ${w.slice(i, i + RUN).join(' ')} `)) return true
  return false
}

/** What a finding is, as Tries compares them. */
export interface FindingLike {
  sceneId: string | null
  from: string
  /** "must fix · facts", "critic · pacing · high". */
  kind: string
  what: string
  quote: string
}

/** What the finding is about, without how much it matters (a check's severity, a note's weight), which can change. */
const aspect = (f: FindingLike): string => {
  const parts = f.kind.split(' · ')
  return (f.from === 'critic' ? parts.slice(0, 2) : parts.slice(1)).join(' · ')
}

/** The same thing found again: the same scene and source, and the same words said of it, or the same aspect of the same words. */
export function sameFinding(a: FindingLike, b: FindingLike): boolean {
  if ((a.sceneId ?? '') !== (b.sceneId ?? '') || a.from !== b.from) return false
  if (foldWords(a.what) && foldWords(a.what) === foldWords(b.what)) return true
  return aspect(a) === aspect(b) && !!a.quote.trim() && !!b.quote.trim() && wordsOverlap(a.quote, b.quote)
}

/**
 * What the run has given the AI to fix, so a finding that keeps coming back stops being given: the checks reword what
 * they find each time, and a fix of a fix draws new findings of its own. `verdict`: 'give' it to the AI; 'skip' (it was
 * set aside before: not raised again); 'leave' it for Adam (given MAX_TRIES times already, or given once and now found
 * on words the AI itself wrote this run, which is the AI arguing with its own fix).
 */
export class Tries {
  private readonly seen: { f: FindingLike; tries: number; setAside: boolean }[] = []

  private find(f: FindingLike) {
    return this.seen.find((s) => sameFinding(s.f, f))
  }

  verdict(f: FindingLike, ownWords: boolean): 'give' | 'skip' | 'leave' {
    const s = this.find(f)
    if (!s) return 'give'
    if (s.setAside) return 'skip'
    if (s.tries >= MAX_TRIES || (s.tries >= 1 && ownWords)) return 'leave'
    return 'give'
  }

  /** Given to the AI once more. */
  given(f: FindingLike): void {
    const s = this.find(f)
    if (s) s.tries++
    else this.seen.push({ f: { ...f }, tries: 1, setAside: false })
  }

  /** Set aside by the AI, with a reason the app accepted: never raised again this run. */
  setAside(f: FindingLike): void {
    const s = this.find(f)
    if (s) s.setAside = true
    else this.seen.push({ f: { ...f }, tries: 1, setAside: true })
  }
}

/** A finding's fingerprint: what it is about, said the same way each time. */
export const findingKey = (sceneId: string, what: string, quote: string): string => `${sceneId}|${squash(what).slice(0, 120)}|${squash(quote).slice(0, 120)}`

/** A fingerprint of the chapter's words. */
export function wordsHash(texts: string[]): string {
  const h = createHash('sha256')
  for (const t of texts) h.update(squash(t)).update('\u0000')
  return h.digest('hex').slice(0, 24)
}

export class ProgressGuard {
  private seen = new Set<string>()
  private lastFindings: string | null = null
  private sameFor = 0

  /**
   * Notes a round's findings and the chapter's words as they were checked. Returns why the run should stop, or null
   * to go on: 'same' (the same findings SAME_ROUNDS rounds in a row) or 'circle' (words already checked before, with
   * findings still open).
   */
  round(findings: string[], words: string): 'same' | 'circle' | null {
    const key = [...new Set(findings)].sort().join('\n')
    const open = findings.length > 0
    const circle = open && this.seen.has(words)
    this.seen.add(words)
    if (open && key === this.lastFindings) this.sameFor++
    else this.sameFor = open ? 1 : 0
    this.lastFindings = key
    if (circle) return 'circle'
    if (this.sameFor >= SAME_ROUNDS) return 'same'
    return null
  }
}

/** How often a chapter draft's words are counted for the progress card. */
const COUNT_EVERY_MS = 500

/**
 * A chapter draft's events, kept from the window (the run puts the words in the scene itself) but heard for the progress
 * card: its words so far (counted now and then; a retake's words taken back), and why its request is being tried again.
 */
export function draftEvents(o: { onWords?: (words: number) => void; onRetry?: (reason: string | null) => void }, clock: () => number = Date.now): Emit {
  let text = ''
  let counted = 0
  const count = (): void => {
    counted = clock()
    o.onWords?.(countWords(text))
  }
  return ((event: string, payload: { text?: string; reason?: string }) => {
    if (event === 'generation:chunk') {
      text += payload.text ?? ''
      if (clock() - counted >= COUNT_EVERY_MS) count()
      o.onRetry?.(null)
    } else if (event === 'generation:takeBack') {
      const gone = payload.text ?? ''
      const at = gone ? text.lastIndexOf(gone) : -1
      if (at >= 0) text = text.slice(0, at)
      count()
    } else if (event === 'generation:retrying') {
      o.onRetry?.(payload.reason || 'The AI didn’t answer')
    } else if (event === 'generation:done') {
      count()
    }
  }) as Emit
}
