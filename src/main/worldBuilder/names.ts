// Matching what a summary names against the world, so a build never makes a near-duplicate: the same name
// or alias of any kind is the entry already there, and so is a clear typo of a long name of the same kind
// (two letters swapped: "Grimbsy" for "Grimsby"). A character's first name alone ("Mara") is the one character whose full name
// starts with it ("Mara Venn"). Names one letter apart are otherwise different people (2026-10-17: "Tom"
// and "Tim", "Mara Venn" and "Mira Venn" were made one). Pure, so every rule is unit-tested.

import type { EntryKind, ID } from '@shared/types'

export interface Named {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
}

/**
 * A name as compared with another: the one rule the World builder and the outline share (2026-10-17). Case, accents,
 * curly quotes, a possessive 's, punctuation and a leading "the" don't count, so "The Café's" and "cafe" are one name,
 * as are "The Salt Guild" and "Salt Guild". Letters of any alphabet are kept.
 */
export const bareName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/'s(?![\p{L}\p{N}])/gu, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')

/** True when a and b differ by at most one inserted, removed or changed letter, or two letters swapped ("grimbsy"). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** True when the one letter that differs between two near-identical names is a digit ("Guard 1" and "Guard 2"). */
export function differsByDigit(a: string, b: string): boolean {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return /\d/.test(a[i] ?? '') || /\d/.test(b[i] ?? '')
}

/** Names the app gives new entries before Adam names them. They never count as the same as anything. */
export const isPlaceholderName = (name: string): boolean =>
  /^(unnamed|new (character|place|group|item|lore|event|plot thread|term))$/.test(bareName(name))

const namesOf = (n: Pick<Named, 'name' | 'aliases'>): string[] =>
  [n.name, ...n.aliases].map(bareName).filter((x) => x && !isPlaceholderName(x))

/** True when two things share a name or other name. */
export const sharesName = (a: Pick<Named, 'name' | 'aliases'>, b: Pick<Named, 'name' | 'aliases'>): boolean => {
  const mine = namesOf(a)
  return namesOf(b).some((n) => mine.includes(n))
}

const firstWord = (s: string): string => s.split(' ')[0] ?? ''

const letters = (s: string): number => s.replace(/[^\p{L}]/gu, '').length

/** True when a and b are the same but for two neighbouring letters swapped ("grimbsy", "grimsby"). */
export function swapsTwo(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false
  let i = 0
  while (a[i] === b[i]) i++
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
}

/**
 * A clear typo of another name, not a second person: both 5 letters or longer, with the same first letter, and
 * two neighbouring letters swapped. A changed, added or doubled letter ("Mira" and "Mara", "Marra" and "Mara",
 * "Bran" and "Brann") could be someone else, so it is (Adam, 2026-10-17: when unsure, they are different).
 */
const isTypoOf = (a: string, b: string): boolean => letters(a) >= 5 && letters(b) >= 5 && a[0] === b[0] && swapsTwo(a, b)

/** A name rather than a description: every word after a leading "The" capitalised, but for small joining words ("Tam of the Hill"). */
export function isProperName(name: string): boolean {
  const words = name.trim().replace(/^the\s+/i, '').split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 6 || isPlaceholderName(name)) return false
  return /^\p{Lu}/u.test(words[0]) && words.every((w) => /^\p{Lu}/u.test(w) || /^(of|the|and|in|on|at|by|de|du|da|di|del|la|le|von|van|y)$/.test(w))
}

/**
 * The entry a name stands for, or null: one with the same name or alias (of any kind, the same kind
 * first), else a clear typo of the one name of the same kind it is near (isTypoOf: no other is one edit
 * away too), else (for a character) the only one whose full name starts with this single name, or whose
 * single name starts this full one.
 *
 * `taken`: entries something else named in the same summary already stands for. They are that other thing,
 * so only the same name of the same kind (or the first-name rule) finds them: "Mira Venn" is not a typo of
 * "Mara Venn" when the summary names both, and the group "Ironhold" is not the place "Ironhold" it names too.
 */
export function findMatch<T extends Named>(
  want: Pick<Named, 'kind' | 'name' | 'aliases'>,
  list: readonly T[],
  taken: ReadonlySet<string> = new Set()
): T | null {
  const mine = namesOf(want)
  if (!mine.length) return null
  const same = (e: T): boolean => namesOf(e).some((n) => mine.includes(n))
  const exact = list.find((e) => e.kind === want.kind && same(e)) ?? list.find((e) => !taken.has(e.id) && same(e))
  if (exact) return exact
  const name = mine[0]
  const near = list.filter((e) => {
    if (e.kind !== want.kind) return false
    const other = namesOf(e)[0]
    return !!other && withinOneEdit(name, other)
  })
  if (near.length === 1 && !taken.has(near[0].id) && isTypoOf(name, namesOf(near[0])[0])) return near[0]
  if (want.kind !== 'character') return null
  const people = list.filter((e) => e.kind === 'character' && namesOf(e).length)
  const single = !name.includes(' ')
  const byFirst = people.filter((e) => {
    const other = namesOf(e)[0]
    return single ? other.includes(' ') && firstWord(other) === name : !other.includes(' ') && firstWord(name) === other
  })
  return byFirst.length === 1 ? byFirst[0] : null
}
