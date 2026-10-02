// Plain words about a summary, for the note under it. Pure, so it is unit-tested.

import type { Summary, SummaryLevel } from '@shared/types'

const NOUN: Record<SummaryLevel, string> = { scene: 'scene', chapter: 'chapter', story: 'story', series: 'series' }

/** Whose words a summary is, and whether it is behind its scene, chapter or story. */
export function summaryNote(summary: Summary | null, level: SummaryLevel): string {
  if (!summary) return ''
  const noun = NOUN[level]
  if (summary.origin === 'adam') {
    return summary.stale ? `Your own words. The ${noun} has changed since you wrote them.` : "Your own words. AI Write won't replace them."
  }
  return summary.stale
    ? `Written by AI Write. It catches up with the ${noun}'s latest changes by itself.`
    : 'Written by AI Write. Edit it to make it your own.'
}
