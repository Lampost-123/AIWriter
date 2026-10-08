// The desk's rooms are the New look's areas (layout/areas.ts): Write, Plan, World and Check, chosen in the middle of the
// top bar. Which room a page belongs to is AREA_OF, so a page opened from anywhere lights its room.
import { useApp } from '@/lib/store'
import { openArea } from '@/layout/AreaRail'
import type { Area } from '@/layout/areas'

/** Opens a room's main page: the writing page, the story board (phase 5), the codex, the story's consistency. */
export function openRoom(room: Area): void {
  const app = useApp.getState()
  if (room === 'plan' && app.storyId) app.navigate({ kind: 'board', storyId: app.storyId })
  else openArea(room)
}
