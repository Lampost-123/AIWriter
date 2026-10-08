// A proposed edit as a word-level change (chat overhaul Phase 2): the words kept, cut and added, so a change card
// shows only what changes with a few words of context either side and "…" for the rest, instead of the whole old
// passage struck through and the whole new one after it. Pure, so it is unit-tested.

export type DiffPart = { kind: 'same' | 'del' | 'ins'; text: string } | { kind: 'gap'; words: number }

/** Words with the spaces after them, so joining the parts gives the text back exactly. */
const tokens = (s: string): string[] => s.match(/\S+\s*|\s+/g) ?? []

/** Compared without the spaces after a word (a word at the end of a paragraph matches the same word mid-line). */
const key = (t: string): string => t.trimEnd()

/** Past this many words on a side, the change is shown whole (cut, then added) rather than worked out word by word. */
const MAX_WORDS = 2500

/** The change from `before` to `after`, word by word: runs of kept, cut and added words, in order. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before)
  const b = tokens(after)
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) return merge([...(before ? [{ kind: 'del' as const, text: before }] : []), ...(after ? [{ kind: 'ins' as const, text: after }] : [])])
  // The longest common run of words, by the usual table (from the end, so it is walked from the start).
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = key(a[i]) === key(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const out: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) {
      // The new text's spacing is the one kept.
      out.push({ kind: 'same', text: b[j] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', text: a[i++] })
    else out.push({ kind: 'ins', text: b[j++] })
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'ins', text: b[j++] })
  return merge(out)
}

/** Runs of the same kind joined; within a changed stretch, every cut goes before every addition. */
function merge(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  let k = 0
  while (k < parts.length) {
    const p = parts[k]
    if (p.kind === 'same' || p.kind === 'gap') {
      const last = out[out.length - 1]
      if (p.kind === 'same' && last?.kind === 'same') last.text += p.text
      else out.push({ ...p })
      k++
      continue
    }
    let del = ''
    let ins = ''
    while (k < parts.length && (parts[k].kind === 'del' || parts[k].kind === 'ins')) {
      const q = parts[k] as { kind: 'del' | 'ins'; text: string }
      if (q.kind === 'del') del += q.text
      else ins += q.text
      k++
    }
    // A cut followed by an addition loses its trailing space: the card puts one between them.
    if (del) out.push({ kind: 'del', text: ins ? del.trimEnd() : del })
    if (ins) out.push({ kind: 'ins', text: ins })
  }
  return out
}

const wordCount = (s: string): number => (s.match(/\S+/g) ?? []).length

/**
 * The change folded to what changes: kept runs longer than `context` words either side of a change keep only those
 * words, the rest becoming a gap ("…"). A change with no kept words at all is left as it is.
 */
export function compactDiff(parts: DiffPart[], context = 4): DiffPart[] {
  const out: DiffPart[] = []
  parts.forEach((p, i) => {
    if (p.kind !== 'same') return void out.push(p)
    const words = tokens(p.text)
    const first = i === 0
    const last = i === parts.length - 1
    const keepHead = first ? 0 : context
    const keepTail = last ? 0 : context
    if (words.length <= keepHead + keepTail + 1) return void out.push(p)
    if (keepHead) out.push({ kind: 'same', text: words.slice(0, keepHead).join('') })
    out.push({ kind: 'gap', words: wordCount(words.slice(keepHead, words.length - keepTail).join('')) })
    if (keepTail) out.push({ kind: 'same', text: words.slice(words.length - keepTail).join('') })
  })
  return out
}

/** True when folding hides something (the card offers to show the whole change). */
export const folds = (parts: DiffPart[], context = 4): boolean => compactDiff(parts, context).some((p) => p.kind === 'gap')

/** How much a change changes: words cut and added. */
export function diffSize(parts: DiffPart[]): { cut: number; added: number } {
  let cut = 0
  let added = 0
  for (const p of parts) {
    if (p.kind === 'del') cut += wordCount(p.text)
    if (p.kind === 'ins') added += wordCount(p.text)
  }
  return { cut, added }
}
