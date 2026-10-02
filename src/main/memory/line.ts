// The line: which stories, chapters and scenes come before a point, in order, following the
// spec's "Multi-story rules" tab. Pure functions over a WorldShape, so every rule is unit-tested
// (see the test world in tests/unit/testWorld*). Every question about "what came earlier" uses
// buildLine, including block 3's previous scene.

import type { ID } from '@shared/types'
import type { StoryPlacement } from '@shared/api'
import type { Line, LineStep, LineTarget, WorldShape } from './types'

/** Every step before the target, in order, and how far the walk went into each story. */
export function buildLine(_shape: WorldShape, _target: LineTarget): Line {
  throw new Error('Not built yet')
}

/**
 * Null when the placement is allowed; otherwise why not, in plain words:
 * "Book 2 can't start during Kell's Road, because Kell's Road starts during Book 2."
 */
export function placementProblem(_shape: WorldShape, _storyId: ID, _placement: StoryPlacement): string | null {
  throw new Error('Not built yet')
}

/** "This story knows what happened in: Book 1; Kell's Road; Book 2 up to the end of Ch 5." */
export function knowsSentence(_shape: WorldShape, _line: Line): string {
  throw new Error('Not built yet')
}

/** Where a scene, chapter or story start is, in plain words: "Book 1, Ch 12, Sc 3", "the start of Book 2". */
export function placeLabel(_shape: WorldShape, _place: { storyId: ID; chapterId?: ID | null; sceneId?: ID | null }): string {
  throw new Error('Not built yet')
}

/** The last scene step on the line itself (never a side story added whole), or null. */
export function previousSceneStep(_line: Line): Extract<LineStep, { type: 'scene' }> | null {
  throw new Error('Not built yet')
}
