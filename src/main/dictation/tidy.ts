// Tidying what the speech model wrote down (milestone 4, "Dictation"): "um", "uh" and the like are taken
// out, with the commas the model put round them, and so are stutters such as "the the"; real doubles
// such as "had had", "that that" or "is is" stay. Capitals and punctuation are the model's own, except
// that a sentence which started with "Um" now starts with the word after it. Pure.

/** Sounds people make while they think: um, umm, uh, uhh, uhm, erm and er (never "err", which is a word). */
const FILLER = /^(?:u+m+|u+h+|u+h+m+|e+r+m+|er)$/i

/**
 * Small words that are only ever doubled by a stumble ("the the", "I I", "and and"). Words that can be
 * doubled on purpose are left out: had had, that that, is is, was was, do do, her her ("gave her her
 * coat"), my my, there there, so so, can can, will will (Will), very very, no no...
 */
const STUMBLES = new Set(
  [
    'a an the and but or if then when just to of in on at by for from with into onto this',
    "i i'm i'll i've i'd it it's its he he's his she she's we we're our they they're their you you're your"
  ]
    .join(' ')
    .split(' ')
)

/** A word (letters and digits, joined by apostrophes or hyphens), a run of spaces, dots, or one other character. */
const TOKEN = /([\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*)|(\s+)|(\.{2,}|[^\s\p{L}\p{N}])/gu

interface Token {
  kind: 'word' | 'space' | 'mark'
  text: string
}

function tokens(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(TOKEN)) out.push({ kind: m[1] ? 'word' : m[2] ? 'space' : 'mark', text: m[0] })
  return out
}

const COMMA = /^[,;]$/
const ENDS = /^(?:\.+|[!?…])$/
const DASH = /^[—–-]$/
/** Where a sentence starts: the beginning, after its end, or after an opening quote or bracket. */
const OPENS = /^(?:\.+|[!?…“‘"(])$/

const mark = (t: Token | undefined, re: RegExp): boolean => !!t && t.kind === 'mark' && re.test(t.text)
const isFiller = (word: string): boolean => FILLER.test(word) && !(word.length > 1 && word === word.toUpperCase())
const startsUpper = (s: string): boolean => /^\p{Lu}/u.test(s)
const startsLower = (s: string): boolean => /^\p{Ll}/u.test(s)
const plain = (word: string): string => word.replace(/’/g, "'").toLowerCase()

/** The nearest token that isn't a space, going `step` (1 or -1) from `i`; -1 when there is none. */
function nearest(list: Token[], i: number, step: 1 | -1): number {
  for (let j = i + step; j >= 0 && j < list.length; j += step) if (list[j].kind !== 'space') return j
  return -1
}

/** Takes out "um", "uh" and the like, with the commas (or the second dash) round them. */
function dropFillers(list: Token[]): Token[] {
  const out = [...list]
  for (let i = 0; i < out.length; i++) {
    const t = out[i]
    if (t.kind !== 'word' || !isFiller(t.text)) continue
    const p = nearest(out, i, -1)
    const n = nearest(out, i, 1)
    const prev = p >= 0 ? out[p] : undefined
    const next = n >= 0 ? out[n] : undefined
    const opening = !prev || mark(prev, OPENS)
    const gone = new Set([i])
    if (mark(next, COMMA)) gone.add(n)
    else if (opening && mark(next, ENDS)) gone.add(n)
    else if (mark(prev, DASH) && mark(next, DASH)) gone.add(n)
    // "was, um going", "then, um." and ", um," (both commas go: the model put them there for the pause).
    if (mark(prev, COMMA) && (gone.has(n) || !next || next.kind === 'word' || mark(next, ENDS))) gone.add(p)
    // A sentence that started with "Um" starts with the word after it.
    const after = nearest(out, Math.max(...gone), 1)
    if (opening && startsUpper(t.text) && after >= 0 && out[after].kind === 'word' && startsLower(out[after].text)) {
      const w = out[after].text
      out[after] = { kind: 'word', text: w[0].toUpperCase() + w.slice(1) }
    }
    for (const g of [...gone].sort((a, b) => b - a)) out.splice(g, 1)
    i = Math.min(...gone) - 1
  }
  return out
}

/** "the the lantern" becomes "the lantern", for the small words people stumble on; real doubles stay. */
function dropStumbles(list: Token[]): Token[] {
  const out: Token[] = []
  for (const t of list) {
    const last = out[out.length - 1]
    const before = out[out.length - 2]
    if (
      t.kind === 'word' &&
      STUMBLES.has(plain(t.text)) &&
      last?.kind === 'space' &&
      before?.kind === 'word' &&
      plain(before.text) === plain(t.text)
    ) {
      out.pop()
      continue
    }
    out.push(t)
  }
  return out
}

const join = (list: Token[]): string => list.map((t) => t.text).join('')

/** Spaces and commas left behind by what was taken out. */
function settle(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?…”)\]])/g, '$1')
    .replace(/([“‘(\[])\s+/g, '$1')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/[,;]\s*([.!?…])/g, '$1')
    .replace(/^[\s,;:]+/, '')
    .trimEnd()
}

/** What the speech model wrote, tidied for typing in: fillers and stutters out, real doubles kept. */
export function tidyDictation(raw: string): string {
  const once = settle(raw)
  if (!once) return ''
  const noFillers = settle(join(dropFillers(tokens(once))))
  return settle(join(dropStumbles(tokens(noFillers))))
}
