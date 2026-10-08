// The desk's rooms are the New look's areas (layout/areas.ts): Write, Plan, World and Check, chosen in the middle of the
// top bar. Which room a page belongs to is AREA_OF, so a page opened from anywhere lights its room.
import { useApp } from '@/lib/store'
import { openArea } from '@/layout/AreaRail'
import { areaOf, type Area } from '@/layout/areas'
import type { View } from '@/lib/store'

/** Opens a room's main page: the writing page, the story board (phase 5), the codex, the story's consistency. */
export function openRoom(room: Area): void {
  const app = useApp.getState()
  if (room === 'plan' && app.storyId) app.navigate({ kind: 'board', storyId: app.storyId })
  else openArea(room)
}

/**
 * Where the story's spine shows on the desk: in every room (Write, Plan, World and Check), full unless Adam collapsed it,
 * so the story is always a click away (Adam, phase 4). The room's frame then keeps clear of it, its sheet centred in the
 * room the spine leaves (RoomFrame). Settings, in no room, has none.
 */
export const spineShowsIn = (view: View): boolean => view.kind === 'write' || areaOf(view) !== null
