// Milestone 5, Live checks part: the words the live checks need and the flags Adam ignored. The logic is
// in src/main/checks/live.ts and the SQL in src/main/db/checksLive.ts.
import type { Handlers } from './index'
import * as world from '../world'
import { emit } from '../events'
import { getWritingPrefs } from '../settings'
import * as repo from '../db/repo'
import { checkWords, ignoreLive, listLiveIgnores, unignoreLive } from '../checks/live'

/** Issues changed in a scene (an ignored flag is an issue row, so lists showing ignored issues catch up). */
function changed(sceneId: string): void {
  let storyId: string | null = null
  try {
    storyId = repo.sceneLocation(world.db(), sceneId).story.id
  } catch {
    // The scene went meanwhile.
  }
  emit('issues:changed', { storyId, sceneIds: [sceneId] })
}

export const liveHandlers: Handlers<'getCheckWords' | 'listLiveIgnores' | 'ignoreLive' | 'unignoreLive'> = {
  getCheckWords: (sceneId) => checkWords(world.db(), sceneId, getWritingPrefs()),
  listLiveIgnores: (sceneId) => listLiveIgnores(world.db(), sceneId),
  ignoreLive: (sceneId, flag) => {
    ignoreLive(world.db(), sceneId, flag)
    repo.touchWorld(world.db())
    changed(sceneId)
  },
  unignoreLive: (sceneId, key) => {
    if (unignoreLive(world.db(), sceneId, key)) {
      repo.touchWorld(world.db())
      changed(sceneId)
    }
  }
}
