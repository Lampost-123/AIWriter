// Milestone 3: the handlers for src/shared/contracts/worldViews.ts (one part owns both files).
// Each view reads the world once (its shape, the memory and the scene cards) and works out everything
// its screen needs with the same line as drafting; the work itself is in src/main/worldViews/.
import type { Handlers } from './index'
import type { WorldViewsApi } from '@shared/contracts/worldViews'
import * as world from '../world'
import * as repo from '../db/repo'
import { emit } from '../events'
import { timelineOf, threadsBoardOf, relationshipMapOf, moveMapCharacter, resetMapLayout } from '../worldViews'
import { markAiIdea, readBoardMarks, storySceneCards } from '../db/worldViews'
import { planThread } from '../keeper/checkQueue'
import { sceneDateView, storyDateViews } from '../memory/storyCalendar'
import { timeCues } from '../continuity/tracker'

export const worldViewsHandlers: Handlers<keyof WorldViewsApi> = {
  getTimeline: (storyId) => timelineOf(world.db(), storyId),
  getRelationshipMap: (storyId, at, sceneId) => relationshipMapOf(world.db(), storyId, at, sceneId ?? null),
  moveMapCharacter: (id, x, y) => moveMapCharacter(world.db(), id, x, y),
  resetMapLayout: () => resetMapLayout(world.db()),
  getThreadsBoard: (storyId) => threadsBoardOf(world.db(), storyId),
  // The promises ledger (long story memory fix 10): a thread's "Pay off by" and Mark as dropped, from the board or Worth
  // a look. The board, Worth a look and the next briefing read it again (memory:changed).
  planThread: (threadId, change) => {
    const db = world.db()
    const undo = db.transaction(() => planThread(db, threadId, change ?? {}))()
    repo.touchWorld(db)
    emit('memory:changed', { sceneId: null, entryIds: [threadId] })
    return undo
  },
  // The desk's story board (UI overhaul, D5.2), each card with its date on the story calendar (fix 11).
  listSceneCards: (storyId) => {
    const db = world.db()
    const cards = storySceneCards(db, storyId)
    const undated = Object.keys(cards).filter((id) => !cards[id].when.trim())
    const dates = storyDateViews(db, storyId, timeCues(db, undated))
    for (const [id, card] of Object.entries(cards)) if (dates[id]) card.date = dates[id]
    return cards
  },
  // The story calendar (long story memory fix 11): what the scene card says under When, for that scene alone (kept with
  // the calendar; the memory's time of day read only for a scene with no When).
  getSceneDate: (sceneId) => {
    const db = world.db()
    return sceneDateView(db, sceneId, (id) => timeCues(db, [id]))
  },
  getBoardMarks: () => readBoardMarks(world.db()),
  markAiIdea: (sceneId, on) => markAiIdea(world.db(), sceneId, on)
}
