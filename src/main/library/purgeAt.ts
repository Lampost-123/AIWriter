// When a deleted world goes for good: the same time of day DELETED_WORLD_DAYS calendar days later, by this computer's
// clock (2026-10-20: 30 days counted as 30 × 24 hours landed an hour earlier across the clocks going back, so a world
// deleted just after midnight showed "29 days"). Pure: no Electron, no files.

import { DELETED_WORLD_DAYS } from '@shared/contracts/library'

export function purgeAtFor(deletedAt: string): string {
  const d = new Date(Date.parse(deletedAt))
  d.setDate(d.getDate() + DELETED_WORLD_DAYS)
  return d.toISOString()
}
