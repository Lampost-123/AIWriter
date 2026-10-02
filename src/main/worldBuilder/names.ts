// Matching what a summary names against the world, so a build never makes a near-duplicate: the same name
// or alias of any kind is the entry already there, and so is a name of the same kind one letter away
// ("Marra" and "Mara"), as the entry pages warn. A character's first name alone ("Mara") is the one
// character whose full name starts with it ("Mara Venn"). Pure, so every rule is unit-tested.

import type { EntryKind, ID } from '@shared/types'

export interface Named {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
}

/** Lower case, accents removed, spaces tidied: "  Márra " -> "marra" (as the entry pages compare names). */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** A name without a leading "the": "The Salt Guild" and "Salt Guild" are one name. */
export const bareName = (s: string): string => normalizeName(s).replace(/^the /, '')

/** True when a and b differ by at most one inserted, removed or changed letter. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
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
  /^(unnamed|new (character|place|group|item|lore|event|plot thread|term))$/.test(normalizeName(name))

const namesOf = (n: Pick<Named, 'name' | 'aliases'>): string[] =>
  [n.name, ...n.aliases].map(bareName).filter((x) => x && !isPlaceholderName(x))

const firstWord = (s: string): string => s.split(' ')[0] ?? ''

/**
 * The entry a name stands for, or null: one with the same name or alias (of any kind, the same kind
 * first), else one of the same kind whose name is one letter away, else (for a character) the only one
 * whose full name starts with this single name, or whose single name starts this full one.
 */
export function findMatch<T extends Named>(want: Pick<Named, 'kind' | 'name' | 'aliases'>, list: readonly T[]): T | null {
  const mine = namesOf(want)
  if (!mine.length) return null
  const same = (e: T): boolean => namesOf(e).some((n) => mine.includes(n))
  const exact = list.find((e) => e.kind === want.kind && same(e)) ?? list.find(same)
  if (exact) return exact
  const name = mine[0]
  const near = list.find((e) => {
    if (e.kind !== want.kind) return false
    const other = namesOf(e)[0]
    return !!other && Math.min(name.length, other.length) >= 3 && withinOneEdit(name, other) && !differsByDigit(name, other)
  })
  if (near) return near
  if (want.kind !== 'character') return null
  const people = list.filter((e) => e.kind === 'character' && namesOf(e).length)
  const single = !name.includes(' ')
  const byFirst = people.filter((e) => {
    const other = namesOf(e)[0]
    return single ? other.includes(' ') && firstWord(other) === name : !other.includes(' ') && firstWord(name) === other
  })
  return byFirst.length === 1 ? byFirst[0] : null
}
