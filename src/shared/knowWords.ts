// Plain words for since when and how a character knows (or believes) something: the who-knows-what ledger (long story
// memory fix 9). The writer's briefing, the checks and the entry page say it the same way: "since Ch 2, Sc 3; heard it
// from Ash", "from the start; saw it". Pure.

import type { ID, Learned } from './types'

/** "saw it", "heard it from Ash", "was told", "overheard Ash", "read it", "guessed it", "said it"; '' when not known. */
export function howWords(l: Pick<Learned, 'how' | 'from'> | null | undefined, nameOf: (id: ID) => string | null | undefined): string {
  if (!l?.how) return ''
  const from = l.from ? (nameOf(l.from) ?? '').trim() : ''
  switch (l.how) {
    case 'saw':
      return 'saw it'
    case 'told':
      return from ? `heard it from ${from}` : 'was told'
    case 'overheard':
      return from ? `overheard ${from}` : 'overheard it'
    case 'read':
      return 'read it'
    case 'guessed':
      return 'guessed it'
    case 'said':
      return 'said it'
  }
}

/**
 * "since Book 1, Ch 2, Sc 3", "since the start of Book 2", or "from the start" for the starting setup; '' when not known.
 * `place` shortens a place (the briefing leaves its own story's title off).
 */
export function sinceWords(l: Pick<Learned, 'at' | 'where'> | null | undefined, place: (where: string) => string = (w) => w): string {
  if (!l) return ''
  const where = place((l.where ?? '').trim()).trim()
  if (where) return `since ${where}`
  return l.at < 0 ? 'from the start' : ''
}

/** Since when and how, as one note: "since Ch 2, Sc 3; heard it from Ash". '' when neither is known. */
export function learnedWords(
  l: Learned | null | undefined,
  nameOf: (id: ID) => string | null | undefined,
  place?: (where: string) => string,
  join = '; '
): string {
  return [sinceWords(l, place), howWords(l, nameOf)].filter(Boolean).join(join)
}
