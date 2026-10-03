// Smart punctuation (writing by hand): as Adam types, straight quotes become curly ones, "--" an em dash,
// a spaced hyphen a spaced en dash and "..." an ellipsis. Pure: given the words of the paragraph up to and
// including what was just typed, it says what to swap at the end, or nothing. The editor side (extension.ts)
// runs it as an input rule, so Backspace or Ctrl+Z straight after puts the plain characters back.

export interface SmartChange {
  /** How many characters at the end to take away (what was just typed, and what it joins with). */
  remove: number
  /** What goes in their place. */
  insert: string
}

export const QUOTES = { open2: '“', close2: '”', open1: '‘', close1: '’' } as const
export const EM_DASH = '—'
export const EN_DASH = '–'
export const ELLIPSIS = '…'

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/** After these (or at the start, or after a space) a quote opens. */
const OPENS_AFTER = new Set(['(', '[', '{', '<', '/', QUOTES.open2, QUOTES.open1, '«', '‹'])
const DASHES = new Set([EM_DASH, EN_DASH, '-'])

/** Words that start with an apostrophe in place of left-out letters, spotted once the word ends ('em, 'tis). */
const ELIDED = ['em', 'tis', 'twas', 'til', 'bout']

/** True when a quote typed after `prev` (the character before it; '' at the start) opens rather than closes. */
function opensAfter(prev: string): boolean {
  return prev === '' || /\s/u.test(prev) || OPENS_AFTER.has(prev)
}

/** Is a double quote still open in these words (more “ than ”)? */
function doubleOpen(text: string): boolean {
  let depth = 0
  for (const ch of text) {
    if (ch === QUOTES.open2) depth++
    else if (ch === QUOTES.close2 && depth > 0) depth--
  }
  return depth > 0
}

/**
 * Is a single quote still open in these words? An apostrophe inside a word (don’t) or before a digit (’90s) closes
 * nothing; a ’ with no letter or digit after it does.
 */
function singleOpen(text: string): boolean {
  const open = text.lastIndexOf(QUOTES.open1)
  if (open < 0) return false
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] !== QUOTES.close1) continue
    const next = text[i + 1] ?? ''
    if (!LETTER_OR_DIGIT.test(next)) return false
  }
  return true
}

/** The curly form of a straight quote typed at the end of `before` (which doesn't include it). */
export function curlyQuote(before: string, quote: '"' | "'"): string {
  const prev = before.slice(-1)
  const double = quote === '"'
  let opens: boolean
  if (DASHES.has(prev)) {
    // After a dash it could be either: “Wait—” closes the words broken off, —“Who’s there?” opens new ones.
    opens = double ? !doubleOpen(before) : !singleOpen(before)
  } else opens = opensAfter(prev)
  if (double) return opens ? QUOTES.open2 : QUOTES.close2
  return opens ? QUOTES.open1 : QUOTES.close1
}

/**
 * What to change at the end of the paragraph's words `text` (up to and including what was just typed), or null.
 */
export function smartChange(text: string): SmartChange | null {
  const last = text.slice(-1)
  if (!last) return null
  const before = text.slice(0, -1)

  if (last === '"' || last === "'") {
    // rock ’n’ roll: the ‘ that opened before the n was an apostrophe.
    if (last === "'" && /(^|\s)‘n$/u.test(before)) return { remove: 3, insert: `${QUOTES.close1}n${QUOTES.close1}` }
    return { remove: 1, insert: curlyQuote(before, last) }
  }

  // ’90s: a digit straight after a quote that opened is an apostrophe for left-out digits.
  if (/\d/.test(last) && before.endsWith(QUOTES.open1) && opensAfter(before.slice(-2, -1))) {
    return { remove: 2, insert: QUOTES.close1 + last }
  }

  // ’em, ’tis: once the word ends, a quote that opened just before it was an apostrophe.
  if (!LETTER_OR_DIGIT.test(last) && last !== "'" && last !== '’') {
    for (const word of ELIDED) {
      const tail = QUOTES.open1 + word
      if (before.endsWith(tail) && opensAfter(before.slice(-tail.length - 1, -tail.length))) {
        return { remove: tail.length + 1, insert: QUOTES.close1 + word + last }
      }
    }
  }

  // "--" is an em dash (not "---", which stays for a scene break at the start of a paragraph).
  if (last === '-' && before.endsWith('-') && !before.endsWith('--')) return { remove: 2, insert: EM_DASH }

  // " - " between words is a spaced en dash.
  if (last === ' ' && before.endsWith(' -') && before.length >= 3 && !/\s/u.test(before.slice(-3, -2))) {
    return { remove: 2, insert: `${EN_DASH} ` }
  }

  // "..." is an ellipsis (not a fourth dot after one already put back as dots).
  if (last === '.' && before.endsWith('..') && !before.endsWith('...')) return { remove: 3, insert: ELLIPSIS }

  return null
}
