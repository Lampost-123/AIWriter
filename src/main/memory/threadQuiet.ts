// The open threads ledger (World Memory Overhaul B4, 2026-10-08): for each plot thread, the scene on a story's line that
// last touched it and how many scenes it has been quiet since. A touch is anything the memory holds about the thread
// at a place on the line: a thread change there (opened, moved on, resolved; a clue note on one of Adam's threads), or
// words in a scene that its facts rest on (a clue, its promise, a mention). Used by the plot threads ledger
// (worldViews/threads.ts) and by the writer's gentle reminder (ai/openThreads.ts). Pure.

import type { ID } from '@shared/types'
import type { Line } from './types'
import type { ChangeIndex } from './state'

/** Quiet for this many scenes or more, and last touched in the story being written: overdue (the writer is reminded). */
export { QUIET_SCENES } from '@shared/contracts/worldViews'

export interface ThreadTouch {
  /** The step of the line where it was last touched. */
  step: number
  /** The scene that last touched it; null for a story's start. */
  sceneId: ID | null
  storyId: ID
  /** Scenes on the line after that one (only those with words, when the caller says which have). */
  quiet: number
}

/**
 * Where each of these threads was last touched on the line, and how many scenes it has been quiet since (counted to
 * the line's end). `linkScenes`: the scenes holding words each thread's facts rest on. `written`: the scenes with words;
 * given, only those count as quiet ones (a story's line runs on through scenes only planned so far). A thread never
 * touched on the line is left out.
 */
export function threadTouches(
  line: Line,
  changes: ChangeIndex,
  threadIds: ID[],
  linkScenes: Map<ID, Set<ID>> = new Map(),
  written?: Set<ID>
): Map<ID, ThreadTouch> {
  const ids = new Set(threadIds)
  const last = new Map<ID, { step: number; sceneId: ID | null; storyId: ID }>()
  for (const c of changes.baseline) if (ids.has(c.entryId)) last.set(c.entryId, { step: -1, sceneId: null, storyId: '' })
  const sceneSteps: number[] = []
  line.steps.forEach((step, i) => {
    if (step.type === 'start-changes') {
      for (const c of changes.byStory.get(step.storyId) ?? []) if (ids.has(c.entryId)) last.set(c.entryId, { step: i, sceneId: null, storyId: step.storyId })
    } else if (step.type === 'scene') {
      if (!written || written.has(step.sceneId)) sceneSteps.push(i)
      const at = { step: i, sceneId: step.sceneId, storyId: step.storyId }
      for (const c of changes.byScene.get(step.sceneId) ?? []) if (ids.has(c.entryId)) last.set(c.entryId, at)
      for (const id of ids) if (linkScenes.get(id)?.has(step.sceneId)) last.set(id, at)
    }
  })
  const out = new Map<ID, ThreadTouch>()
  for (const [id, t] of last) out.set(id, { ...t, quiet: sceneSteps.filter((s) => s > t.step).length })
  return out
}
