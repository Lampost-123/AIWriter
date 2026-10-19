// Each passage once in a request (2026-10-19: a stand-in test found the end of the previous scene three times in one
// draft request: as the end of the previous scene, in what the plan looked up, and in the earlier passages a search
// found). A passage is told by its runs of words: one whose runs are mostly in what the request already carries is said
// again. Pure.

/** How many words in a row make a run. */
export const RUN_WORDS = 8
/** A passage with this share of its runs already sent is a repeat. */
export const REPEAT_SHARE = 0.5

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** A text's runs of RUN_WORDS words (a shorter text: all of it, as one run). */
export function wordRuns(text: string, n = RUN_WORDS): Set<string> {
  const w = words(text)
  const out = new Set<string>()
  if (!w.length) return out
  if (w.length < n) {
    out.add(w.join(' '))
    return out
  }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}

/** The share of `runs` already in `seen` (0 for none). */
export function coveredShare(runs: ReadonlySet<string>, seen: ReadonlySet<string>): number {
  if (!runs.size) return 0
  let n = 0
  for (const r of runs) if (seen.has(r)) n++
  return n / runs.size
}

/** A block's text in parts: what comes before its first "### " heading, then each "### " passage with its heading. */
export function passagesOf(text: string): { lead: string; passages: string[] } {
  const parts = text.split(/\n\n(?=### )/)
  return parts[0].startsWith('### ') ? { lead: '', passages: parts } : { lead: parts[0], passages: parts.slice(1) }
}

/**
 * A block's text without the "### " passages already sent (their runs mostly in `seen`); the passages kept are added to
 * `seen`. `left`: how many passages are kept. The lead (and any facts before the first passage) stays.
 */
export function withoutRepeats(text: string, seen: Set<string>): { text: string; left: number; removed: number } {
  const { lead, passages } = passagesOf(text)
  const kept: string[] = []
  let removed = 0
  for (const p of passages) {
    const body = p.replace(/^### [^\n]*\n?/, '')
    const runs = wordRuns(body)
    if (runs.size && coveredShare(runs, seen) >= REPEAT_SHARE) {
      removed++
      continue
    }
    for (const r of runs) seen.add(r)
    kept.push(p)
  }
  return { text: [lead, ...kept].filter((x) => x.trim()).join('\n\n'), left: kept.length, removed }
}
