// What the desk's status island says (the New look's desk layout, top bar). One small pill that changes what it says
// rather than adding more things to the bar: "Saved · 1,167 words" with today's target ring while all is well, "Writing…
// 212 words" while a draft writes into the scene, "Memory · 2 changes" for a moment after the memory keeper changed
// something, and the save trouble when there is any. Pure, so it is unit-tested; StatusIsland.tsx draws it.
import type { SaveState } from '@/lib/store'

export type IslandShows = 'saved' | 'saving' | 'unsaved' | 'writing' | 'memory'

export interface IslandInput {
  saveState: SaveState
  /** The writing page shows (the scene's own words only mean something there). */
  onPage: boolean
  /** The open scene's words. */
  sceneWords: number
  /** A draft is being written: into the scene on screen (with the words written so far, when known) or elsewhere. */
  draft: { here: boolean; written: number | null } | null
  /** The memory keeper changed something a moment ago (how many changes). */
  memory: { changes: number } | null
  /** Today's target (Settings › Editor) and the words typed today. */
  daily: number | null
  typedToday: number
}

export interface Island {
  shows: IslandShows
  /** The scene's words beside "Saved" (null off the writing page). */
  words: number | null
  /** The words a draft has written so far (null: not known, it writes elsewhere). */
  written: number | null
  /** The memory keeper's changes. */
  changes: number
  /** Today's share of the daily target, 0 to 1 (null: no target). */
  goalShare: number | null
  /** The same as a percentage, for the words beside the ring. */
  goalPercent: number | null
}

/** What the island shows now: save trouble first, then a draft writing, then the memory's news, then saving or saved. */
export function islandState(i: IslandInput): Island {
  const shows: IslandShows =
    i.saveState === 'error'
      ? 'unsaved'
      : i.draft
        ? 'writing'
        : i.memory
          ? 'memory'
          : i.saveState === 'saving' && i.onPage
            ? 'saving'
            : 'saved'
  const share = i.daily && i.daily > 0 ? Math.max(0, i.typedToday) / i.daily : null
  return {
    shows,
    words: i.onPage ? Math.max(0, i.sceneWords) : null,
    written: i.draft?.here && i.draft.written !== null ? Math.max(0, i.draft.written) : null,
    changes: i.memory?.changes ?? 0,
    goalShare: share === null ? null : Math.min(1, share),
    goalPercent: share === null ? null : Math.min(999, Math.round(share * 100))
  }
}

/** "1,167 words", "1 word". */
export const wordsText = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'word' : 'words'}`

/** "2 changes", "1 change". */
export const changesText = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'change' : 'changes'}`
