// Put events in their place (2026-10-19): the words of the timeline's offer to move the events earlier builds left at the
// story's start to the scenes they happen in (src/main/worldViews/eventHomes.ts), and remembering "Not now" on this
// computer. Pure; tested in eventPlacesLogic.test.ts.
import type { EventHome, EventHomeWhy } from '@shared/contracts/worldViews'
import type { ID } from '@shared/types'

/** The offer: "12 events from the World builder can go to the scenes they belong to." */
export const offerWords = (n: number): string =>
  n === 1 ? '1 event from the World builder can go to the scene it belongs to.' : `${n} events from the World builder can go to the scenes they belong to.`

/** Under the offer: where they wait now, and that nothing moves until Adam says so. */
export const OFFER_DETAIL = 'Now they count from the story’s start, so earlier scenes already know of them. Nothing else changes, and Undo puts them back.'

/** Why the record says an event happens in that scene, in plain words. */
export const WHY_WORDS: Record<EventHomeWhy, string> = {
  text: 'your words tell it there',
  plan: 'the story’s plan puts it there',
  card: 'the scene card names it',
  date: 'it falls on that scene’s day'
}

/** The toast once they have moved: "Moved 12 events to the scenes they happen in." */
export const movedWords = (n: number): string =>
  n === 1 ? 'Moved 1 event to the scene it happens in.' : `Moved ${n} events to the scenes they happen in.`

/** The toast when none could move (each has moved or changed since the offer was made). */
export const NONE_MOVED = 'Those events have changed since, so nothing was moved.'

/** The events ticked to move: every one offered, but those Adam unticked. */
export const picked = (homes: readonly EventHome[], off: ReadonlySet<ID>): ID[] => homes.filter((h) => !off.has(h.entryId)).map((h) => h.entryId)

/** Where "Not now" is kept on this computer (localStorage), by world and story. */
export const SKIP_KEY = 'aiwrite.timeline.eventPlaces'

/** What "Not now" remembers for an offer: the events it held, so a new one shows again. */
export const skipValue = (homes: readonly EventHome[]): string => [...new Set(homes.map((h) => h.entryId))].sort().join(',')

/** True when Adam said "Not now" to an offer holding no events beyond these. */
export function skipped(saved: string | null | undefined, homes: readonly EventHome[]): boolean {
  if (!saved || !homes.length) return false
  const was = new Set(saved.split(','))
  return homes.every((h) => was.has(h.entryId))
}

/** The skips as kept: world and story to the events said "Not now" to; anything unreadable counts for none. */
export function readSkips(raw: string | null): Record<string, string> {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {}
  } catch {
    return {}
  }
}
