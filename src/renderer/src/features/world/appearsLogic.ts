// Pure helpers for an entry page's "Appears in" (milestone 3): how the entry is in each scene, in
// plain words. Tested in appearsLogic.test.ts.

import type { AppearanceHow } from '@shared/contracts/entryViews'
import type { EntryKind } from '@shared/types'

const WORDS: Record<AppearanceHow, string> = {
  pov: 'Point of view',
  present: 'In the scene',
  location: 'Where it’s set',
  named: 'Named',
  changes: 'Changes here'
}

/**
 * "Point of view · Named", in the order the main process gives (point of view first). Being named is
 * left unsaid when the words are shown.
 */
export function howText(how: AppearanceHow[], quoted: boolean, kind: EntryKind): string {
  const shown = how.filter((h) => !(h === 'named' && quoted))
  return shown.map((h) => (h === 'changes' && kind !== 'character' ? 'Changed here' : WORDS[h])).join(' · ')
}

/** How many scenes "Appears in" lists at first, and adds with each "Show more". */
export const APPEARS_STEP = 50

/** "Show 50 more" or, near the end, "Show the last 12". */
export function showMoreText(shown: number, total: number): string {
  const left = total - shown
  return left > APPEARS_STEP ? `Show ${APPEARS_STEP} more` : left === 1 ? 'Show the last one' : `Show the last ${left}`
}

/** A scene's own title, unless it is only the one every new scene gets ("Scene 3"), which its place already says. */
export const ownTitle = (title: string): string => (/^scene \d+$/i.test(title.trim()) ? '' : title.trim())
