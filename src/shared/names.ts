// Spotting characters however they are named (long story memory fix 12, 2026-10-15). A character is found in a text by
// their name, their other names, and what one scene's words call them ("the Captain", "her brother": CalledName, read
// by the memory keeper, keeper/names.ts, and kept for that scene, db/called.ts). One rule for reading a name, shared by
// the writer's briefing (ai/context.ts `mentions`), the memory keeper (keeper/text.ts `mentionAt`), what must stay true
// (memory/items.ts `nameIn`) and the page's underlines (features/editor/names/nameMatch.ts):
// - a whole word or phrase: no letter or number just before or after it, so "Mara's" names Mara and "Marabel" doesn't;
//   nor a hyphen joining another word after it, so "Will" isn't in "Will-o’-the-wisp";
// - any apostrophe for any (' ’ ‘), so "O'Brien" is "O’Brien", as the keeper's quotes fold them (keeper/text.ts);
// - a single capitalised word ("Will", "Hope") only capitalised, so "will" and "hope" never count; a phrase, or a name
//   that isn't capitalised ("the old woman", "her brother"), whatever its case;
// - "Will" or "May" opening a sentence as the verb is the word, not the name: with "you", "the", "not" and the like
//   straight after ("Will you come?", "May I?"), or a verb as it is after "will" ("Will be there.", "May be the last
//   time."), with or without "never", "still" and the like between ("Will never forget it."). "Will drew his knife",
//   "Will still had the knife", "Will could see the shore" and "said Will" still name him.
// Words in scripts without capitals or spaces between words (Arabic, Chinese, Japanese) aren't read this way: a known limit.
// Pure, so it is unit-tested (names.test.ts).

import type { ID } from './types'

/** Something a scene's words call a character that isn't one of their names ("the Captain", "her brother"). */
export interface CalledName {
  entryId: ID
  /** The words, as the scene has them. */
  words: string
}

/** True when a name is matched whatever its case: a phrase, or a name that isn't capitalised. */
export const ignoresCase = (name: string): boolean => /\s/.test(name.trim()) || !/^\p{Lu}/u.test(name.trim())

/** Curly apostrophes as a straight one, for a quick look before the pattern ("o’brien" is "o'brien"). */
export const foldApostrophes = (s: string): string => s.replace(/[’‘]/g, "'")

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A name as a pattern: its words with any spaces between them, any apostrophe standing for any. */
export const namePattern = (name: string): string =>
  escapeRe(name.trim())
    .replace(/\s+/g, '\\s+')
    .replace(/['’‘]/g, "['’‘]")
/** No letter or number just before a name. */
export const NAME_BEFORE = '(?<![\\p{L}\\p{N}])'
/** No letter or number just after a name, nor a hyphen joining another word ("Will-o’-the-wisp"); "Mara’s" is fine. */
export const NAME_AFTER = '(?![\\p{L}\\p{N}]|-[\\p{L}\\p{N}])'

/** Names that are also words that open a question or a wish. */
const ASKING = new Set(['will', 'may'])
/** What comes straight after such a word when it is the verb: "Will you", "May I", "Will the boat hold", "Will not". */
const ASKED = new Set(
  `i you he she it we they this that these those there the a an your my his her our their its anyone someone everyone
  anybody somebody everybody nobody no not all any each god heaven`.split(/\s+/)
)
/**
 * Verbs as they are after "will" or "may", never after a name ("Will be there", but "Will was"): only those whose past
 * is another word, so "Will let her go" (he let her go) still names him. Not "can", "could", "would" or "must": "Will
 * could see the shore" is the name.
 */
const BARE_VERBS = new Set(
  `be have do go come get make take see know say tell give find forget forgive need want stop leave stay wait try keep
  help look hold mind matter happen change work end last fail return understand believe remember live die win lose bring
  follow show turn speak talk ask answer pay call sleep eat drink run walk fight sit stand`.split(/\s+/)
)
/** Words that may come between the verb "will" and the verb it goes with: "Will never forget", "May still be". */
const BETWEEN = new Set(`never always still just also only ever soon surely really probably certainly perhaps even yet`.split(/\s+/))
/** What may stand between the start of a sentence and its first word: spaces, opening quotes and brackets, dashes. */
const OPENERS = /[\s"'“‘«(\[—–-]/u

/**
 * True when `at` is where a sentence begins: the start of the text, or after a full stop, question or exclamation mark,
 * colon or semicolon, or an opening quote or bracket (what is said opens a sentence of its own), with only spaces,
 * quotes, brackets and dashes between.
 */
export function startsSentence(text: string, at: number): boolean {
  let i = at - 1
  let quote = false
  while (i >= 0 && OPENERS.test(text[i])) {
    if (!/\s/u.test(text[i])) quote = true
    i--
  }
  return i < 0 || quote || /[.!?…:;]/u.test(text[i])
}

/** True when the word at [start, end) of the text is "Will" or "May" as the verb, not the name: "Will you come?". */
export function askingAt(text: string, start: number, end: number): boolean {
  if (!ASKING.has(text.slice(start, end).toLowerCase())) return false
  const next = /^\s+(\p{L}+)(?:\s+(\p{L}+))?/u.exec(text.slice(end, end + 60))
  if (!next) return false
  const [w1, w2] = [next[1].toLowerCase(), next[2]?.toLowerCase() ?? '']
  const verb = ASKED.has(w1) || BARE_VERBS.has(w1) || (BETWEEN.has(w1) && BARE_VERBS.has(w2))
  return verb && startsSentence(text, start)
}

/** Each name's pattern, made once (a briefing looks for the same few hundred names in each text). */
const patterns = new Map<string, RegExp>()
function nameRe(name: string): RegExp {
  let re = patterns.get(name)
  if (!re) {
    if (patterns.size > 5_000) patterns.clear()
    re = new RegExp(`${NAME_BEFORE}${namePattern(name)}${NAME_AFTER}`, ignoresCase(name) ? 'giu' : 'gu')
    patterns.set(name, re)
  }
  re.lastIndex = 0
  return re
}

/** Where `name` first names someone in `text` (the rules at the top of this file), or null. */
export function findName(text: string, name: string): { start: number; end: number } | null {
  const n = name.trim()
  if (n.length < 2 || !text) return null
  for (const m of text.matchAll(nameRe(n))) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (!askingAt(text, start, end)) return { start, end }
  }
  return null
}

/** True when the text names someone by `name` (the rules at the top of this file). */
export const namedInProse = (text: string, name: string): boolean => findName(text, name) !== null

/** What a scene's words call one character (its CalledName words). */
export const calledFor = (list: readonly CalledName[] | undefined, entryId: ID): string[] =>
  (list ?? []).filter((c) => c.entryId === entryId).map((c) => c.words)

/** The first word of a name: "Nell" of "Nell Harrow". Not "The" ("The Duke"), nor a one-word or lower-case name. */
export function firstNameOf(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = words[0] ?? ''
  return words.length > 1 && first.length >= 2 && /^\p{Lu}/u.test(first) && !/^the$/i.test(first) ? first : ''
}

/**
 * A person's first name when no one else goes by it ("Nell" for Nell Harrow): no other name's first word and no other
 * name or other name is the same, whatever its case. Empty when they have no such first name or someone shares it.
 */
export function soleFirstName(name: string, others: readonly string[]): string {
  const first = firstNameOf(name)
  if (!first) return ''
  const f = first.toLowerCase()
  const taken = others.some((o) => {
    const n = o.trim().toLowerCase()
    return n === f || n.split(/\s+/)[0] === f
  })
  return taken ? '' : first
}
