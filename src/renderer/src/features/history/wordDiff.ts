// Comparing an earlier version of a scene with the scene now, for the History page: paragraphs are
// lined up side by side, and in each changed pair the words that differ are marked. Pure (no React,
// no window), so it is unit-tested.

/** One step of an edit script: the same in both, only in the first, or only in the second. */
export type Op = 'same' | 'then' | 'now'

/**
 * The shortest edit script from `a` to `b` (Myers' algorithm), or null when they differ in more than
 * `maxEdits` places (too different to be worth lining up item by item).
 */
export function editScript<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean, maxEdits = 2000): Op[] | null {
  const n = a.length
  const m = b.length
  const max = n + m
  if (max === 0) return []
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  // v as it was before each round, kept only where that round can look (k from -d-1 to d+1).
  const trace: Int32Array[] = []
  const limit = Math.min(max, maxEdits)
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && same(a[x], b[y])) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]
    const at = (k: number): number => v[k + d + 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('same')
      x--
      y--
    }
    if (d > 0) ops.push(x === prevX ? 'now' : 'then')
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

// ---------- Words ----------

/** A run of text on one side of the comparison, marked when the other side doesn't have it. */
export interface Piece {
  text: string
  changed: boolean
}

/** Words (with the hyphens and apostrophes inside them), runs of spaces, and single marks of punctuation. */
const TOKEN = /[\p{L}\p{N}\p{M}'’]+(?:[-‐][\p{L}\p{N}\p{M}'’]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu

export const tokenize = (text: string): string[] => text.match(TOKEN) ?? []

const isSpace = (t: string): boolean => /^\s+$/.test(t)
/** Spaces count as the same whatever they are, so a changed line break doesn't mark the words around it. */
const sameToken = (a: string, b: string): boolean => a === b || (isSpace(a) && isSpace(b))

/** Joins neighbouring pieces, and marks the spaces between two marked words so a change reads as one stretch. */
function tidy(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  pieces.forEach((p, i) => {
    const bridge = !p.changed && isSpace(p.text) && pieces[i - 1]?.changed && pieces[i + 1]?.changed
    const changed = p.changed || !!bridge
    const last = out[out.length - 1]
    if (last && last.changed === changed) last.text += p.text
    else out.push({ text: p.text, changed })
  })
  return out
}

/** The same text on both sides, nothing marked. */
const plain = (text: string): Piece[] => (text ? [{ text, changed: false }] : [])

/** Two versions of a paragraph, each with the words the other doesn't have marked. */
export function diffWords(then: string, now: string): { then: Piece[]; now: Piece[] } {
  if (then === now) return { then: plain(then), now: plain(now) }
  const a = tokenize(then)
  const b = tokenize(now)
  // What both share at the start and end is left out of the search, which keeps a small change quick in a long paragraph.
  let start = 0
  while (start < a.length && start < b.length && sameToken(a[start], b[start])) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && sameToken(a[a.length - 1 - end], b[b.length - 1 - end])) end++
  const midA = a.slice(start, a.length - end)
  const midB = b.slice(start, b.length - end)
  const ops = editScript(midA, midB, sameToken, 1500)
  const left: Piece[] = [{ text: a.slice(0, start).join(''), changed: false }]
  const right: Piece[] = [{ text: b.slice(0, start).join(''), changed: false }]
  if (!ops) {
    // Too different to match word by word: the whole middle is marked on both sides.
    left.push({ text: midA.join(''), changed: true })
    right.push({ text: midB.join(''), changed: true })
  } else {
    let i = 0
    let j = 0
    for (const op of ops) {
      if (op === 'same') {
        left.push({ text: midA[i++], changed: false })
        right.push({ text: midB[j++], changed: false })
      } else if (op === 'then') {
        const t = midA[i++]
        left.push({ text: t, changed: !isSpace(t) })
      } else {
        const t = midB[j++]
        right.push({ text: t, changed: !isSpace(t) })
      }
    }
  }
  left.push({ text: a.slice(a.length - end).join(''), changed: false })
  right.push({ text: b.slice(b.length - end).join(''), changed: false })
  return { then: tidy(left.filter((p) => p.text)), now: tidy(right.filter((p) => p.text)) }
}

// ---------- Paragraphs ----------

/** One row of the side-by-side comparison. */
export type Row =
  | { kind: 'same'; text: string }
  | { kind: 'changed'; then: Piece[]; now: Piece[] }
  /** A paragraph only the earlier version has. */
  | { kind: 'then'; text: string }
  /** A paragraph only the scene now has. */
  | { kind: 'now'; text: string }

/** A scene's paragraphs (its text keeps them apart with blank lines; a scene break is "* * *"). */
export const paragraphsOf = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+$/, ''))
    .filter((p) => p.trim())

const wordsOf = (p: string): string[] => (p.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? []).map((w) => w.replace(/’/g, "'"))

/** How alike two paragraphs are, from 0 (no words in common) to 1 (the same words). */
export function likeness(a: string, b: string): number {
  const wa = wordsOf(a)
  const wb = wordsOf(b)
  if (!wa.length && !wb.length) return a.trim() === b.trim() ? 1 : 0
  if (!wa.length || !wb.length) return 0
  const counts = new Map<string, number>()
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1)
  let common = 0
  for (const w of wb) {
    const c = counts.get(w) ?? 0
    if (c > 0) {
      common++
      counts.set(w, c - 1)
    }
  }
  return (2 * common) / (wa.length + wb.length)
}

/** Paragraphs at least this alike are shown side by side as one changed paragraph; less alike, as one gone and one new. */
const ALIKE = 0.4

/**
 * Pairs the paragraphs that went with those that came in their place, keeping both in order and pairing
 * the most alike (a small alignment by likeness). Returns pairs of indexes into `gone` and `came`.
 */
function pairUp(gone: string[], came: string[]): [number, number][] {
  const a = gone.length
  const b = came.length
  if (!a || !b) return []
  if (a * b > 2500) {
    // A very large change: paired in order where alike enough.
    const pairs: [number, number][] = []
    for (let i = 0; i < Math.min(a, b); i++) if (likeness(gone[i], came[i]) >= ALIKE) pairs.push([i, i])
    return pairs
  }
  const sim = gone.map((g) => came.map((c) => likeness(g, c)))
  // best[i][j]: the most likeness pairing gone[i..] with came[j..] can reach.
  const best = Array.from({ length: a + 1 }, () => new Float64Array(b + 1))
  for (let i = a - 1; i >= 0; i--) {
    for (let j = b - 1; j >= 0; j--) {
      const pair = sim[i][j] >= ALIKE ? sim[i][j] + best[i + 1][j + 1] : -1
      best[i][j] = Math.max(pair, best[i + 1][j], best[i][j + 1])
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < a && j < b) {
    if (sim[i][j] >= ALIKE && best[i][j] === sim[i][j] + best[i + 1][j + 1]) {
      pairs.push([i, j])
      i++
      j++
    } else if (best[i][j] === best[i + 1][j]) i++
    else j++
  }
  return pairs
}

/** The rows for one stretch where paragraphs went and others came: pairs side by side, the rest on their own. */
function hunkRows(gone: string[], came: string[]): Row[] {
  const rows: Row[] = []
  let i = 0
  let j = 0
  for (const [pi, pj] of [...pairUp(gone, came), [gone.length, came.length] as [number, number]]) {
    while (i < pi) rows.push({ kind: 'then', text: gone[i++] })
    while (j < pj) rows.push({ kind: 'now', text: came[j++] })
    if (pi < gone.length && pj < came.length) {
      const words = diffWords(gone[i++], came[j++])
      rows.push({ kind: 'changed', then: words.then, now: words.now })
    }
  }
  return rows
}

/** An earlier version of a scene beside the scene now, paragraph by paragraph. */
export function compareTexts(then: string, now: string): Row[] {
  const a = paragraphsOf(then)
  const b = paragraphsOf(now)
  const ops = editScript(a, b, (x, y) => x === y, 2000)
  if (!ops) return hunkRows(a, b)
  const rows: Row[] = []
  let i = 0
  let j = 0
  let gone: string[] = []
  let came: string[] = []
  const flush = (): void => {
    if (gone.length || came.length) rows.push(...hunkRows(gone, came))
    gone = []
    came = []
  }
  for (const op of ops) {
    if (op === 'same') {
      flush()
      rows.push({ kind: 'same', text: a[i++] })
      j++
    } else if (op === 'then') gone.push(a[i++])
    else came.push(b[j++])
  }
  flush()
  return rows
}
