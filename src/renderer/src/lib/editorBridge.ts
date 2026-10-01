import type { ID } from '@shared/types'

/**
 * How the AI drafting code talks to the manuscript editor without importing it.
 * The editor (features/editor) registers itself; the Generate controls
 * (features/generate) stream text into it.
 *
 * Rules: streamed text is inserted at the end of the scene, after a paragraph
 * break, without moving the view or Adam's cursor. Each chunk is part of the
 * normal document, so autosave keeps it and Ctrl+Z can undo the whole draft
 * as one step. Switching scenes while a draft is streaming stops the draft
 * first (the text so far is kept).
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
}

let current: EditorBridge | null = null

export function setEditorBridge(b: EditorBridge | null): void {
  current = b
}

export const editorBridge = (): EditorBridge | null => current
