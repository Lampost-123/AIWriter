// Continue: the AI writes on from the cursor (from the palette, and from the AI tools over selected words,
// which carry on after them). About a paragraph or two, following the scene card's beats, as a tracked
// change Adam accepts or rejects (session.ts). Owned by the AI edits part.
import { startTool } from './session'

/** Writes on from the cursor, or after the selected words. */
export function continueFromCursor(): void {
  void startTool('continue')
}
