// What is true at a point: each entry's state, relationships, who knows what, plot threads and
// which entries exist, worked out from baselines plus every change that counts on a Line.
// Pure functions, so every rule is unit-tested.

import type { Change, ID } from '@shared/types'
import type { Line, MemoryData, MemoryState, WorldShape } from './types'

/** Applies every change that counts on the line, in line order, to the baselines. */
export function stateAt(_data: MemoryData, _shape: WorldShape, _line: Line): MemoryState {
  throw new Error('Not built yet')
}

/** Changes pinned to a scene (never facts while drafting that scene). */
export function changesInScene(_data: MemoryData, _sceneId: ID): Change[] {
  throw new Error('Not built yet')
}
