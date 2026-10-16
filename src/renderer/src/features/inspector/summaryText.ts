// Plain words about a summary, for the note under it. Pure, so it is unit-tested.

import type { Summary, SummaryLevel } from '@shared/types'

const NOUN: Record<SummaryLevel, string> = { scene: 'scene', chapter: 'chapter', story: 'story', series: 'series' }

/** Whose words a summary is, and whether it is behind its scene, chapter or story (then it is being brought up to date). */
export function summaryNote(summary: Summary | null, level: SummaryLevel): string {
  if (!summary) return ''
  const noun = NOUN[level]
  if (summary.origin === 'adam') {
    return summary.stale ? `Your own words. The ${noun} has changed since you wrote them.` : "Your own words. AI Write won't replace them."
  }
  // Out of date (long story memory fix 15): what it was made from has changed, and AI Write is writing it again.
  const whose = noun === 'series' ? "series'" : `${noun}'s`
  return summary.stale ? `Being brought up to date with the ${whose} latest changes.` : 'Written by AI Write. Edit it to make it your own.'
}
