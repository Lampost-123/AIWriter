// Is the chapter writer still getting somewhere? There is no cap on rounds (Adam's choice), so the run stops when a
// round of checking makes no progress: the same findings left after two tries at fixing them, or the chapter's
// words back to a version already checked (the AI going round in circles, fixing one thing by undoing another). Pure.

import { createHash } from 'node:crypto'

/** Rounds in a row that find exactly the same things (found, then two tries at fixing them) before the run stops. */
export const SAME_ROUNDS = 3

const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

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
