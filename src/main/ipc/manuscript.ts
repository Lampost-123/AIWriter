// Milestone 3: the handlers for src/shared/contracts/manuscript.ts (one part owns both files).
import type { Handlers } from './index'
import type { ManuscriptApi } from '@shared/contracts/manuscript'
import * as world from '../world'
import { sceneNames } from '../manuscript/sceneNames'

export const manuscriptHandlers: Handlers<keyof ManuscriptApi> = {
  getSceneNames: (sceneId) => sceneNames(world.db(), sceneId)
}
