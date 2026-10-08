// The desk's rooms are the New look's areas (layout/areas.ts): Write, Plan, World and Check, chosen in the middle of the
// top bar. Which room a page belongs to is AREA_OF, so a page opened from anywhere lights its room.
import { openArea } from '@/layout/AreaRail'
import type { Area } from '@/layout/areas'

/** Opens a room's main page: the writing page, the outline helper, the codex, the story's consistency. */
export function openRoom(room: Area): void {
  openArea(room)
}
