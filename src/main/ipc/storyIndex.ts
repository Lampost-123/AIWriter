// "Fill in the whole story" (the story index, 2026-10-19): roughly what it costs, then every scene of a story not yet
// filled in, one after another in the background (storyIndex/fill.ts, run by keeper/indexing.ts), with Stop.
import type { Handlers } from './index'
import type { StoryIndexApi } from '@shared/contracts/storyIndex'
import * as repo from '../db/repo'
import * as world from '../world'
import { emit } from '../events'
import { UserError } from '../util'
import { memoryModel, memoryStatus } from '../keeper'
import { storyFiller } from '../keeper/indexing'
import { estimateFill, scenesToFill } from '../storyIndex/fill'

// While this month's spending limit holds AI calls, the window asks before startStoryFill runs (usage ASKS_FIRST), as for
// a re-read; so the estimate and the start look only at whether there is a memory model. A limit reached part way
// through ends the fill with its note (keeper/indexing.ts).
const model = memoryModel

export const storyIndexHandlers: Handlers<keyof StoryIndexApi> = {
  estimateStoryFill: (storyId) => {
    const db = world.db()
    repo.getStory(db, storyId)
    return estimateFill(db, storyId, model())
  },
  startStoryFill: (storyId) => {
    const db = world.db()
    const story = repo.getStory(db, storyId)
    const m = model()
    if ('error' in m) throw new UserError(m.error, 'no-memory-model')
    const filler = storyFiller(db)
    if (!filler) throw new UserError('The story can’t be filled in right now. Close the world and open it again, then try once more.')
    // Already going for this story: nothing more to start.
    if (filler.current()?.storyId === storyId) return
    const ids = scenesToFill(db, storyId).map((s) => s.id)
    if (!ids.length) throw new UserError('Every scene of this story is filled in already.')
    filler.fillStory(storyId, story.title.trim() || 'Untitled story', ids)
    emit('memory:status', memoryStatus())
  },
  stopStoryFill: () => {
    storyFiller(world.db())?.stopStory()
    emit('memory:status', memoryStatus())
  }
}
