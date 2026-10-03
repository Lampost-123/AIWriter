// The start screen's words and choices (features/start/): what each world and story card says, which worlds a
// search finds, the order of the worlds and where Continue goes. Pure, so it is unit-tested.

import type { ID } from '@shared/types'
import { DELETED_WORLD_DAYS, type DeletedWorld, type LastPlace, type LibraryStory, type LibraryWorld } from '@shared/contracts/library'
import { fold } from '@/features/palette/paletteLogic'
import { relativeTime } from '@/features/generate/format'

/** How long a deleted world waits in Recently deleted: "30 days". */
export const DELETED_DAYS_TEXT = `${DELETED_WORLD_DAYS} days`

/** The search box shows once there are more worlds than this. */
export const SEARCH_FROM = 6

const n = (x: number): string => x.toLocaleString('en-GB')

/** "No stories", "1 story", "4 stories". */
export const storiesText = (count: number): string => (count === 0 ? 'No stories' : count === 1 ? '1 story' : `${n(count)} stories`)

/** "No words yet", "1 word", "212,000 words". */
export const wordsText = (count: number): string => (count === 0 ? 'No words yet' : count === 1 ? '1 word' : `${n(count)} words`)

/** What a world holds, for the middle of a sentence: "4 stories, 212,000 words", "1 story, no words yet", "no stories". */
export function holdsText(stories: number, words: number): string {
  if (stories === 0) return 'no stories'
  return `${storiesText(stories)}, ${words === 0 ? 'no words yet' : wordsText(words)}`
}

/** When, after a verb: "just now", "5 minutes ago", "yesterday at 14:05", "on 3 Oct 2026". '' when unknown. */
export function whenText(iso: string, nowMs: number = Date.now()): string {
  if (!iso) return ''
  const r = relativeTime(iso, nowMs)
  if (!r) return ''
  return /^\d/.test(r) && !/ago$/.test(r) ? `on ${r}` : r
}

/** A world card's line: "4 stories · 212,000 words · Opened yesterday at 14:05". */
export function worldLine(w: Pick<LibraryWorld, 'stories' | 'words' | 'openedAt'>, nowMs: number = Date.now()): string {
  const when = whenText(w.openedAt, nowMs)
  return [storiesText(w.stories.length), wordsText(w.words), when ? `Opened ${when}` : ''].filter(Boolean).join(' · ')
}

/** A story row's "Edited yesterday at 14:05" ('' when unknown). */
export function editedText(iso: string, nowMs: number = Date.now()): string {
  const when = whenText(iso, nowMs)
  return when ? `Edited ${when}` : ''
}

/**
 * What each story is, in a few words: its own (a prequel, a side story), else "Book N", counting the world's
 * plain stories in reading order.
 */
export function storyKinds(stories: Pick<LibraryStory, 'id' | 'kind'>[]): Record<ID, string> {
  const out: Record<ID, string> = {}
  let book = 0
  for (const s of stories) out[s.id] = s.kind.trim() || `Book ${++book}`
  return out
}

/** The open world first (Adam is in it), then the rest as the library gives them (newest opened first). */
export function orderWorlds<W extends Pick<LibraryWorld, 'id'>>(worlds: W[], openId: ID | null): W[] {
  const open = openId ? worlds.find((w) => w.id === openId) : undefined
  return open ? [open, ...worlds.filter((w) => w !== open)] : worlds
}

export interface ShownWorld {
  world: LibraryWorld
  /** The stories to list: all of them, or only those the search found by title. */
  stories: LibraryStory[]
  /** Found by one of its stories' titles (not its own name): its card shows them straight away. */
  byStory: boolean
}

/** The worlds a search finds, by their name or by a story's title (ignoring case and accents). */
export function filterWorlds(worlds: LibraryWorld[], query: string): ShownWorld[] {
  const q = fold(query.trim())
  if (!q) return worlds.map((world) => ({ world, stories: world.stories, byStory: false }))
  const out: ShownWorld[] = []
  for (const world of worlds) {
    if (fold(world.name).includes(q)) out.push({ world, stories: world.stories, byStory: false })
    else {
      const stories = world.stories.filter((s) => fold(s.title).includes(q))
      if (stories.length) out.push({ world, stories, byStory: true })
    }
  }
  return out
}

/** A deleted world's line: "4 stories, 212,000 words · Goes for good in 29 days". */
export function deletedLine(d: Pick<DeletedWorld, 'stories' | 'words' | 'purgeAt'>, nowMs: number = Date.now()): string {
  const holds = holdsText(d.stories, d.words)
  return `${holds.charAt(0).toUpperCase()}${holds.slice(1)} · ${goesText(d.purgeAt, nowMs)}`
}

/** "Goes for good in 29 days", "Goes for good tomorrow", "Goes for good today". */
export function goesText(purgeAt: string, nowMs: number = Date.now()): string {
  const t = Date.parse(purgeAt)
  if (Number.isNaN(t)) return `Goes for good after ${DELETED_DAYS_TEXT}`
  // Counted in calendar days, so a clock change never makes it a day more or less.
  const day = (ms: number): number => {
    const d = new Date(ms)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000
  }
  const days = Math.round(day(t) - day(nowMs))
  if (days <= 0) return 'Goes for good today'
  if (days === 1) return 'Goes for good tomorrow'
  return `Goes for good in ${days} days`
}

/** The Continue card's words: the big line (the scene, else the story, else the world) and the line under it. */
export function continueText(p: Pick<LastPlace, 'worldName' | 'storyTitle' | 'sceneTitle' | 'at'>, nowMs: number = Date.now()): { title: string; where: string } {
  const title = p.sceneTitle.trim() || p.storyTitle.trim() || p.worldName
  const parts = [p.sceneTitle.trim() ? p.storyTitle.trim() : '', p.worldName].filter(Boolean)
  const when = whenText(p.at, nowMs)
  return { title, where: [parts.join(' › '), when ? `Left off ${when}` : ''].filter(Boolean).join(' · ') }
}
