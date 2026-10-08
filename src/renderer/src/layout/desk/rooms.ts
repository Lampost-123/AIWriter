// The desk's rooms are the New look's areas (layout/areas.ts): Write, Plan, World and Check, chosen in the middle of the
// top bar. Which room a page belongs to is AREA_OF, so a page opened from anywhere lights its room.
import { openArea } from '@/layout/AreaRail'
import { areaOf, type Area } from '@/layout/areas'
import type { View } from '@/lib/store'

/** Opens a room's main page: the writing page, the outline helper, the codex, the story's consistency. */
export function openRoom(room: Area): void {
  openArea(room)
}

/**
 * Where the story's spine shows on the desk: beside the writing page, and beside the World room's pages (UI overhaul phase
 * 4), so the story stays a click away from its world. The room's frame then keeps clear of it.
 */
export const spineShowsIn = (view: View): boolean => view.kind === 'write' || areaOf(view) === 'world'
