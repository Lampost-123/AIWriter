// Who is dead by a point in the story, from what has happened to them (Adam, 2026-10-04: a live run's dead monk was
// written sleeping, and missed). Used by the scene card's "Dead by this point" line and the "must stay true" list.
// Pure.

import type { EntryState } from '@shared/types'

// A note is about its own entry and has no subject ("died in the fire"), so a death counts only where the note's own
// verb is the dying: at its start, or after "and", "then" or "later" ("fought the watch and was killed"). "Admitted
// Anselm died in the fire" (a live run) is someone else's.
const OWN_DEATH = [
  /^\s*(?:(?:was|were|is|now|then|later|finally)\s+)?(died|dies|perished|drowned|dead)\b/i,
  /^\s*(?:(?:was|were|is)\s+)?(?:presumed|declared|reported|found|confirmed|left for)\s+(dead|drowned|killed|murdered)\b/i,
  /^\s*(?:(?:was|were)\s+)?(?:(killed|murdered|drowned|slain|executed|hanged)\s+(by|in|at|on|during|while|when|after|before)\b|burned to death)/i,
  /\b(?:and|then|later|but)\s+(?:was\s+)?(died|perished|killed by|drowned in|drowned at|murdered by|slain by)\b/i
]
/** A note about someone else's death, or news of one. */
const OTHERS_DEATH =
  /\b(learn(s|ed|t)?|heard|hears|told|tells|saw|sees|watch(es|ed)|mourn(s|ed)?|bur(y|ies|ied)|news|grieve(s|d)?|avenge(s|d)?|said|says|admit(s|ted)|claim(s|ed)|reveal(s|ed)|confess(es|ed)|believe(s|d)|fear(s|ed))\b/i
/** Words that undo a death ("not dead after all", "survived"). */
const ALIVE = /\b(not dead|alive after all|survived|returned alive|was alive|is alive|faked (?:his|her|their) death)\b/i

/**
 * A note in what has happened to a character that says they themselves died: "died in the fire", "presumed dead",
 * "killed by the watch", "was found drowned". Not one about someone else's death ("killed the guard", "learned
 * Anselm was dead", "watched her father die").
 */
export const saysDied = (note: string): boolean => OWN_DEATH.some((re) => re.test(note)) && !OTHERS_DEATH.test(note)

/**
 * The note that says a character is dead by now, with where it happened: the latest that says they died, unless a
 * later one says they live. Null for anyone alive, and for anything that isn't a character.
 */
export function deathOf(e: Pick<EntryState, 'kind' | 'happened'>): { note: string; where: string } | null {
  if (e.kind !== 'character') return null
  let found: { note: string; where: string } | null = null
  for (const h of e.happened ?? []) {
    if (ALIVE.test(h.note)) found = null
    else if (saysDied(h.note)) found = { note: h.note.trim(), where: h.where }
  }
  return found
}
