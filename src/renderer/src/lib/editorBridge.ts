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
 */
export interface EditorBridge {
  /** The scene the editor is showing. */
  sceneId: ID | null
  /** Prepares to receive a streamed draft. Returns false if the editor isn't showing that scene. */
  beginStream(sceneId: ID, generationId: ID): boolean
  appendStream(generationId: ID, text: string): void
  endStream(generationId: ID): void
  /** Saves the scene right now (if anything changed). */
  flush(): Promise<void>
  /** Current plain text of the scene. */
  getText(): string
  /** True when the page has any writing on it. */
  hasText(): boolean
  /**
   * Stops a draft being written into the page (because Adam opened another scene or world),
   * once its last words are in. Says so in a message. Does nothing when no draft is writing.
   */
  stopDraft(reason: 'scene' | 'world'): Promise<void>
}

let current: EditorBridge | null = null

export function setEditorBridge(b: EditorBridge | null): void {
  current = b
}

export const editorBridge = (): EditorBridge | null => current
