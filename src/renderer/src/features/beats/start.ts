// Starting Beat by beat on a scene, from the toolbar button or the palette (milestone 4). See flow.ts.
import type { ID } from '@shared/types'
import { openBeats } from './flow'

/**
 * Starts Beat by beat on the open scene. `byKey`: asked from the keyboard (the palette, or Enter on the
 * button), so in "This scene already has text" the answer that has the keyboard shows it.
 */
export function startBeatByBeat(sceneId: ID, o: { byKey?: boolean } = {}): void {
  void openBeats(sceneId, o.byKey ?? true)
}
