// Matching a name the AI gave to one of the world's entries (the interview's fill, chapter cards). No imports
// beyond types, so anything in the outline helper can use it without import loops.
import type { ID } from '@shared/types'

/** Titles a character's name may start with ("Captain Holt" is Holt), compared without their full stop. */
export const NAME_TITLES = [
  'captain',
  'capt',
  'dr',
  'doctor',
  'mr',
  'mrs',
  'ms',
  'miss',
  'sir',
  'lady',
  'lord',
  'dame',
  'king',
  'queen',
  'prince',
  'princess',
  'duke',
  'duchess',
  'father',
  'mother',
  'brother',
  'sister',
  'master',
  'mistress',
  'professor',
  'prof',
  'sergeant',
  'sgt',
  'lieutenant',
  'lt',
  'general',
  'commander',
  'uncle',
  'aunt'
] as const

/**
 * A name as compared with another (2026-10-17): case, accents, curly quotes, a possessive 's, punctuation and a
 * leading "the" don't count, so "The Café's" and "cafe" are one name. Letters of any alphabet are kept.
 */
export const nameKey = (s: string): string =>
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

const TITLE = new RegExp(`^(?:${NAME_TITLES.join('|')}) (?=.)`)

/** A name key without a leading title ("captain holt" gives "holt"); a title alone ("the duke") stays as it is. */
export const stripTitle = (key: string): string => key.replace(TITLE, '')

type Named = { id: ID; name: string; aliases: string[] }

/** Titles and surnames only go for characters (an entry with no kind is taken as one): "King's Landing" stays whole. */
const isPerson = (e: Named): boolean => {
  const kind = (e as { kind?: unknown }).kind
  return kind === undefined || kind === 'character'
}

/**
 * The entry a name means, and whether it could mean more than one (2026-10-17: so the outline never makes a third
 * "Mara" beside "Mara Venn" and "Mara Kell"). In order: its name or an alias exactly; the same once a leading title
 * is dropped ("Captain Holt" and "Holt"); else the only one whose name starts with it ("Mara" for "Mara Venn"),
 * that starts it, or (for a character) whose single name is its last word ("Holt" for "Jon Holt"). Two or more
 * at that step: ambiguous, and no entry.
 */
export function matchName<T extends Named>(name: string, entries: T[]): { entry: T | null; ambiguous: boolean } {
  const n = nameKey(name)
  if (!n) return { entry: null, ambiguous: false }
  const keys = (e: T): string[] => [e.name, ...e.aliases].map(nameKey).filter(Boolean)
  const exact = entries.find((e) => keys(e).includes(n))
  if (exact) return { entry: exact, ambiguous: false }
  const pick = (found: T[]): { entry: T | null; ambiguous: boolean } =>
    found.length === 1 ? { entry: found[0], ambiguous: false } : { entry: null, ambiguous: found.length > 1 }
  const titled = entries.filter((e) => isPerson(e) && keys(e).some((k) => stripTitle(k) === stripTitle(n)))
  if (titled.length) return pick(titled)
  const starts = (want: string, k: string, person: boolean): boolean =>
    k.startsWith(`${want} `) || want.startsWith(`${k} `) || (person && !k.includes(' ') && want.includes(' ') && want.split(' ').pop() === k)
  // A character's name is tried with and without its title ("Captain Mara" for "Mara Venn", "Duke Orsin" for "The Duke").
  const found = entries.filter((e) =>
    keys(e).some((k) => starts(n, k, isPerson(e)) || (isPerson(e) && starts(stripTitle(n), stripTitle(k), true)))
  )
  return pick(found)
}

/** The entry a name means: its name or an alias exactly, else the only one whose name starts with it ("Mara" for "Mara Venn"). */
export function matchEntry<T extends Named>(name: string, entries: T[]): T | null {
  return matchName(name, entries).entry
}
