// The automatic story flows (spec, Multi-story rules: "Automatic flows"), milestone 3:
//   model.ts    which model they use (one function, flowTarget)
//   prompts.ts  what the model is told for each flow
//   context.ts  each request, read from the world
//   call.ts     one call to the model, with its record of what the AI saw
//   parse.ts    reading each reply
//   apply.ts    writing the results into the memory, with their lines in What changed
//   lines.ts    Undo and answers on those lines, and their places in plain words
//   jobs.ts     each flow from start to finish
//   runner.ts   running them in the background, one at a time per story and flow
// This file connects them to the open world, the settings and the window.

import type { ID } from '@shared/types'
import type { StoryFlowKind, StoryFlowStatus } from '@shared/contracts/storyFlows'
import { currentWorld, maybeCurrentWorld, onWorldClosing } from '../world'
import { getWritingPrefs } from '../settings'
import { emit } from '../events'
import { memoryStatus } from '../keeper'
import { flowTarget } from './model'
import { FlowRunner } from './runner'
import type { FlowArgs } from './jobs'

let runner: FlowRunner | null = null

/** The open world's runner, made the first time a flow is asked for. */
function current(): FlowRunner {
  const w = currentWorld()
  if (runner && runner.db === w.db) return runner
  runner?.close()
  runner = new FlowRunner({
    db: w.db,
    model: flowTarget,
    prefs: getWritingPrefs,
    emitStatus: (s) => emit('story:flow', s),
    emitChanged: (p) => {
      emit('memory:changed', { sceneId: null, entryIds: [...new Set(p.entryIds)] })
      emit('memory:status', memoryStatus())
    }
  })
  return runner
}

// Closing a world stops its flows; nothing is written to it after.
onWorldClosing((w) => {
  if (runner && runner.db === w.db) {
    runner.close()
    runner = null
  }
})

export function startStoryFlow(args: FlowArgs): void {
  current().start(args)
}

export function stopStoryFlow(storyId: ID, flow: StoryFlowKind): void {
  if (runner && runner.db === maybeCurrentWorld()?.db) runner.stop(storyId, flow)
}

export function listStoryFlows(storyId: ID): StoryFlowStatus[] {
  return runner && runner.db === maybeCurrentWorld()?.db ? runner.list(storyId) : []
}
