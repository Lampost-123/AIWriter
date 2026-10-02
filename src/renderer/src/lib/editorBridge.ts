import type { ID } from '@shared/types'

/**
 * How the AI drafting code talks to the manuscript editor without importing it.
 * The editor (features/editor) registers itself; the Generate controls
 * (features/generate) stream text into it.
 *
 * Rules: streamed text is inserted at the end of the scene without moving the
 * view or Adam's cursor. When the scene already has text, the draft starts below
 * a scene break, and while it is being written out of sight a small "new draft
 * below" pointer shows at the bottom of the page. Each chunk is part of the
 * normal document, so autosave keeps it and Ctrl+Z undoes the whole draft (with
 * its scene break) as one step. Going to another page keeps the draft writing;
 * opening another scene (or switching worlds) stops it first, and the text so
 * far is kept.
 *
 * With `replace`, the draft takes the place of the scene's text instead: the old
 * text is held as it is (dimmed, and nothing can change it) from the moment Adam
 * picks Replace it until the draft's first words arrive, then goes in the same step,
 * and the page shows the top of the scene. The old text is kept with the draft's
 * record at that moment. One Ctrl+Z puts it back exactly. A draft that brings no
 * words leaves the old text untouched.
 */
export interface EditorBridge {
  /** The scene the editor is showing. */
  sceneId: ID | null
  /**
   * Holds the scene's text as it is while a draft that will replace it gets ready, so nothing typed
   * in the meantime goes with it. Returns false if the editor isn't showing that scene.
   */
  holdForReplace(sceneId: ID): boolean
  /** Lets go of held text when the draft that was to replace it didn't start. */
  releaseHold(): void
  /** Prepares to receive a streamed draft. Returns false if the editor isn't showing that scene. */
  beginStream(sceneId: ID, generationId: ID, opts?: { replace?: boolean }): boolean
  appendStream(generationId: ID, text: string): void
  /**
   * Ends the draft. `failed`: it ended with a problem that Generate reports itself, so the page says
   * nothing. Returns whether the draft took the place of the scene's text.
   */
  endStream(generationId: ID, opts?: { failed?: boolean }): { replaced: boolean }
  /** Adam picked where the draft goes: the keyboard goes into the page (once it can take it), so Ctrl+Z works there. */
  takeKeyboard(): void
  /** Ctrl+Z pressed outside the page (on the Generate button, say): undoes in the page. False when there was nothing to undo. */
  undo(): boolean
  /** Saves the scene right now (if anything changed). */
  flush(): Promise<void>
  /** Current plain text of the scene. */
  getText(): string
  /** True when the page has any writing on it. */
  hasText(): boolean
  /**
   * Stops a draft being written into the page (because Adam opened another scene or world, or is
   * deleting the scene), once its last words are in. Says so in a message. Does nothing when no
   * draft is writing.
   */
  stopDraft(reason: 'scene' | 'world' | 'deleted'): Promise<void>
}

let current: EditorBridge | null = null

export function setEditorBridge(b: EditorBridge | null): void {
  current = b
}

export const editorBridge = (): EditorBridge | null => current
