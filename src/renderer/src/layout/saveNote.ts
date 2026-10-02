// What the top bar says about saving the open scene. Pure (no React, no window), so it is unit-tested.

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The top bar's note about saving the open scene ('' when it says nothing). The other pages (an
 * entry, the style guide, Settings) show their own save notes, so there the bar keeps quiet about
 * the scene unless its words couldn't be saved, and then says it is the scene.
 */
export function saveNote(state: SaveState, writing: boolean): string {
  if (state === 'error') return writing ? 'Not saved, retrying' : 'Scene not saved, retrying'
  if (!writing) return ''
  return state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''
}
