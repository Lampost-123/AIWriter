// Which scene Adam has just left, so the memory reads it then (spec: a run happens on leaving a
// scene). Pure (no React, no window), so it is unit-tested; events.ts feeds it the app's state.
import type { ID } from '@shared/types'

export interface Place {
  sceneId: ID
  worldId: ID
}

export interface WritingState {
  /** The scene open in the writing view, or null on another page (or with no scene open). */
  here: Place | null
  /** The open world. */
  worldId: ID | null
  /** The scene a draft is being written into right now. */
  drafting: ID | null
}

const samePlace = (a: Place | null, b: Place | null): boolean => a?.sceneId === b?.sceneId && a?.worldId === b?.worldId

/**
 * Follows where Adam writes. Each call takes the app's state now and returns the scenes to read now:
 * the one he left by opening another scene or another page. Not after a world switch (that world
 * reads its scenes when it next opens), and not while a draft is still being written into it: that
 * scene is read once the draft ends (stopped or finished), unless Adam is back in it by then.
 */
export function createLeaveTracker(): (state: WritingState) => Place[] {
  let writingIn: Place | null = null
  let afterDraft: Place | null = null
  return ({ here, worldId, drafting }) => {
    const out: Place[] = []
    const leave = (left: Place): void => {
      if (left.worldId !== worldId) return
      if (drafting === left.sceneId) afterDraft = left
      else out.push(left)
    }
    if (writingIn && !samePlace(here, writingIn)) leave(writingIn)
    writingIn = here
    if (afterDraft && drafting !== afterDraft.sceneId) {
      const left = afterDraft
      afterDraft = null
      if (!samePlace(here, left)) leave(left)
    }
    return out
  }
}
