// Milestone 3: the handlers for src/shared/contracts/worldViews.ts (one part owns both files).
// Each view reads the world once (its shape, the memory and the scene cards) and works out everything
// its screen needs with the same line as drafting; the work itself is in src/main/worldViews/.
import type { Handlers } from './index'
import type { WorldViewsApi } from '@shared/contracts/worldViews'
import * as world from '../world'
import { timelineOf, threadsBoardOf, relationshipMapOf, moveMapCharacter, resetMapLayout } from '../worldViews'
import { markAiIdea, readBoardMarks, storySceneCards } from '../db/worldViews'

export const worldViewsHandlers: Handlers<keyof WorldViewsApi> = {
  getTimeline: (storyId) => timelineOf(world.db(), storyId),
  getRelationshipMap: (storyId, at, sceneId) => relationshipMapOf(world.db(), storyId, at, sceneId ?? null),
  moveMapCharacter: (id, x, y) => moveMapCharacter(world.db(), id, x, y),
  resetMapLayout: () => resetMapLayout(world.db()),
  getThreadsBoard: (storyId) => threadsBoardOf(world.db(), storyId),
  // The desk's story board (UI overhaul, D5.2).
  listSceneCards: (storyId) => storySceneCards(world.db(), storyId),
  getBoardMarks: () => readBoardMarks(world.db()),
  markAiIdea: (sceneId, on) => markAiIdea(world.db(), sceneId, on)
}
