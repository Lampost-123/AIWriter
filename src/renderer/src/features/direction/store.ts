// What the direction composer offers back (features/direction): the directions given before in the open story (read
// from the records by recentDirections, a moment's IPC, and again whenever a box is used), those given this session
// before their records are read back, and the starred ones (Adam's writing preferences, for every world). Also the
// rule that a direction set in Generate's draft options is used once: once a draft has started with it, it clears, so a
// later draft never takes it up unseen (its "Direction: …" label goes with it).
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { DirectionKind, DirectionSource, RecentDirection } from '@shared/contracts/direction'
import { beatDirections, directionKey, tidyDirection, withFavourite } from '@shared/directions'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { mergeRecents, type UsedDirection } from './logic'

/** The boxes offer directions for writing on, or for rewriting chosen words. */
export type BoxKind = Exclude<DirectionKind, 'all'>

/** How many directions a box offers back. */
export const RECENT_LIMIT = 40
/** A list read this recently is used as it is (each box asks again when it gets the keyboard). */
const FRESH_MS = 2000

interface Recents {
  items: RecentDirection[]
  at: number
}

interface DirectionState {
  favourites: string[]
  favouritesLoaded: boolean
  /** The directions given before, by where they were read for (world, story, kind). */
  recents: Record<string, Recents>
  /** Given this session, by where (world, story, kind), newest last. */
  used: Record<string, UsedDirection[]>
}

export const useDirections = create<DirectionState>(() => ({ favourites: [], favouritesLoaded: false, recents: {}, used: {} }))

/** Where a box's directions are read for: the open world and story, and the kind. */
export function scopeOf(kind: BoxKind, s: { world: { id: ID } | null; storyId: ID | null } = useApp.getState()): string {
  return `${s.world?.id ?? ''}|${s.storyId ?? ''}|${kind}`
}

/** Reads the directions given before for a kind of box, unless they were read a moment ago (or `force`). */
export async function loadRecents(kind: BoxKind, force = false): Promise<void> {
  const app = useApp.getState()
  if (!app.world) return
  const scope = scopeOf(kind, app)
  const had = useDirections.getState().recents[scope]
  if (!force && had && Date.now() - had.at < FRESH_MS) return
  try {
    const items = await api.recentDirections(app.storyId, RECENT_LIMIT, kind)
    useDirections.setState((s) => ({ recents: { ...s.recents, [scope]: { items, at: Date.now() } } }))
  } catch {
    // Offering them back is a help, never a need: the box works without.
  }
}

/** The starred directions, read once a session. */
export async function loadFavourites(): Promise<void> {
  if (useDirections.getState().favouritesLoaded) return
  try {
    const favourites = await api.directionFavourites()
    useDirections.setState({ favourites, favouritesLoaded: true })
  } catch {
    // As above: the box works without them.
  }
}

/** Stars a direction (or takes its star away) at once on screen; the preferences file follows. */
export async function setFavourite(text: string, on: boolean): Promise<void> {
  const before = useDirections.getState().favourites
  useDirections.setState({ favourites: withFavourite(before, text, on) })
  try {
    const favourites = await api.setDirectionFavourite(text, on)
    useDirections.setState({ favourites, favouritesLoaded: true })
  } catch (e) {
    useDirections.setState({ favourites: before })
    toast(e instanceof Error ? e.message : "The star couldn't be saved. Try again in a moment.", { tone: 'danger' })
  }
}

export const isFavourite = (favourites: readonly string[], text: string): boolean => {
  const key = directionKey(text)
  return !!key && favourites.some((f) => directionKey(f) === key)
}

/**
 * A direction has just been given (a draft, a beat, Continue, a Rewrite started with it): offered back at once, before
 * its record is read (a draft waits for the memory before it is recorded).
 */
export function noteUsed(text: string, source: DirectionSource): void {
  const tidy = tidyDirection(text)
  if (!tidy) return
  const kind: BoxKind = source === 'rewrite' ? 'rewrite' : 'scene'
  const scope = scopeOf(kind)
  useDirections.setState((s) => {
    const list = (s.used[scope] ?? []).filter((u) => directionKey(u.text) !== directionKey(tidy))
    return { used: { ...s.used, [scope]: [...list, { text: tidy, at: new Date().toISOString(), source }].slice(-50) } }
  })
}

/** The directions a box offers back, newest first: those read from the records and those given this session. */
export function useRecentDirections(kind: BoxKind): RecentDirection[] {
  const scope = useApp((s) => scopeOf(kind, s))
  const read = useDirections((s) => s.recents[scope])
  const used = useDirections((s) => s.used[scope])
  return mergeRecentsCached(scope, read, used)
}

/** mergeRecents, worked out again only when either list changes (so the list keeps its identity between renders). */
const merged = new Map<string, { read: Recents | undefined; used: UsedDirection[] | undefined; out: RecentDirection[] }>()
function mergeRecentsCached(scope: string, read: Recents | undefined, used: UsedDirection[] | undefined): RecentDirection[] {
  const had = merged.get(scope)
  if (had && had.read === read && had.used === used) return had.out
  const out = mergeRecents(read?.items ?? [], used ?? [], RECENT_LIMIT)
  merged.set(scope, { read, used, out })
  return out
}

// ---------- Generate's direction, used once ----------

let watching = false
const settled = new Set<ID>()

/**
 * Watches for drafts starting: once a Generate draft (or a beat) is being written, its direction is offered back, and a
 * draft's direction typed in the draft options clears there (if it is still the one the draft used), so the next draft
 * never takes it up unseen. A draft that failed to start keeps it, to try again.
 */
export function watchDraftDirections(): void {
  if (watching) return
  watching = true
  useApp.subscribe((s, prev) => {
    const g = s.activeGeneration
    if (!g || g === prev.activeGeneration || settled.has(g.id)) return
    settled.add(g.id)
    void settle(g.id, g.sceneId)
  })
}

async function settle(id: ID, sceneId: ID): Promise<void> {
  const rec = await api.getGeneration(id).catch(() => null)
  if (!rec || !rec.direction.trim()) return
  if (rec.job === 'beat') {
    for (const d of beatDirections(rec.direction)) noteUsed(d, 'beat')
    return
  }
  if (rec.job !== 'draft' || rec.params.variant) return
  noteUsed(rec.direction, 'draft')
  const app = useApp.getState()
  // The draft was given the typed direction (as it was typed, or within what it was told): it has been used.
  const typed = directionKey(app.draftOptions[sceneId]?.direction ?? '')
  if (typed && directionKey(rec.direction).includes(typed)) app.setDraftOptions(sceneId, { direction: '' })
}
