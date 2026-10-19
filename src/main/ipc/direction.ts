// The handlers for src/shared/contracts/direction.ts: the direction composer's recent directions (read from the open
// world's generation records, db/directions.ts) and the starred ones (Adam's writing preferences file, settings.ts).
import type { Handlers } from './index'
import type { DirectionApi, DirectionKind } from '@shared/contracts/direction'
import * as world from '../world'
import { recentDirections } from '../db/directions'
import { directionFavourites, setDirectionFavourite } from '../settings'

const KINDS: DirectionKind[] = ['scene', 'rewrite', 'all']

export const directionHandlers: Handlers<keyof DirectionApi> = {
  recentDirections: (storyId, limit, kind) => {
    // No world open (the start screen): nothing given yet.
    if (!world.maybeCurrentWorld()) return []
    return recentDirections(world.db(), {
      storyId: typeof storyId === 'string' && storyId ? storyId : null,
      limit: typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined,
      kind: kind && KINDS.includes(kind) ? kind : 'scene'
    })
  },
  directionFavourites: () => directionFavourites(),
  setDirectionFavourite: (text, on) => setDirectionFavourite(text, on)
}
