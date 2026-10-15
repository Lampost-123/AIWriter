// Spotting characters however they are named (long story memory fix 12, 2026-10-15). A character is found in a text by
// their name, their other names, and what one scene's words call them ("the Captain", "her brother": CalledName, read
// by the memory keeper, keeper/names.ts, and kept for that scene, db/called.ts). The rules the writer's briefing
// (ai/context.ts), the memory keeper and the page's underlines (features/editor/names/nameMatch.ts) share:
// - a whole word or phrase: no letter or number just before or after it, so "Mara's" names Mara and "Marabel" doesn't;
// - a single capitalised word ("Will", "Hope") only capitalised, so "will" and "hope" never count; a phrase, or a name
//   that isn't capitalised ("the old woman", "her brother"), whatever its case;
// - in prose, "Will" or "May" at the start of a sentence with "you", "the", "not" or the like straight after it is the
//   word, not the name ("Will you come?", "May I?"). "Will drew his knife" and "said Will" still name him.
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

/** Names that are also words that open a question or a wish. */
const ASKING = new Set(['will', 'may'])
/** What comes straight after such a word when it is the verb: "Will you", "May I", "Will the boat hold", "Will not". */
const ASKED = new Set(
  `i you he she it we they this that these those there the a an your my his her our their its anyone someone everyone
  anybody somebody everybody nobody no not all any each god heaven`.split(/\s+/)
)
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

/** True when the word at [start, end) of the text is "Will" or "May" asking, not the name: "Will you come?". */
export function askingAt(text: string, start: number, end: number): boolean {
  if (!ASKING.has(text.slice(start, end).toLowerCase())) return false
  const next = /^\s+(\p{L}+)/u.exec(text.slice(end, end + 40))
  return !!next && ASKED.has(next[1].toLowerCase()) && startsSentence(text, start)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Each name's pattern, made once (a briefing looks for the same few hundred names in each text). */
const patterns = new Map<string, RegExp>()
function nameRe(name: string): RegExp {
  let re = patterns.get(name)
  if (!re) {
    if (patterns.size > 5_000) patterns.clear()
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, ignoresCase(name) ? 'giu' : 'gu')
    patterns.set(name, re)
  }
  re.lastIndex = 0
  return re
}

/** True when prose names someone by `name` (the rules at the top of this file). */
export function namedInProse(text: string, name: string): boolean {
  const n = name.trim()
  if (n.length < 2 || !text) return false
  for (const m of text.matchAll(nameRe(n))) {
    const at = m.index ?? 0
    if (!askingAt(text, at, at + m[0].length)) return true
  }
  return false
}

/** What a scene's words call one character (its CalledName words). */
export const calledFor = (list: readonly CalledName[] | undefined, entryId: ID): string[] =>
  (list ?? []).filter((c) => c.entryId === entryId).map((c) => c.words)
