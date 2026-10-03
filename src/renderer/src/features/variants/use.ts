// Putting a variant (or the paragraphs picked from the set) into the scene. The scene is kept in its
// history first ("Before a variant"), then its whole text is put in place as one step Ctrl+Z takes back,
// and the writing page shows it, with the keyboard in the page and a message saying how to undo it.
// The writing page stays in place (hidden) under the Variants page, so the editor can take it from here.

import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { modKey } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { requestPutBack } from '@/features/editor/putBack'
import { snapshotBefore } from '@/features/history/snapshot'
import { sceneWith, type UseMode, type VariantBlock } from './merge'

/** Why the scene can't take a variant right now, in plain words; null when it can. */
export function sceneNotReady(sceneId: ID): string | null {
  const bridge = editorBridge()
  if (!bridge || bridge.sceneId !== sceneId)
    return "This scene isn't open in the editor, so nothing went into it. Open the scene, then try again."
  if (bridge.busy()) return 'A draft is being written into this scene. Stop it first, or wait for it to finish.'
  return null
}

/** True when the scene has writing on it, so Adam is asked whether the new text replaces it or goes below it. */
export const sceneHasText = (sceneId: ID): boolean => {
  const bridge = editorBridge()
  return !!bridge && bridge.sceneId === sceneId && bridge.hasText()
}

/** The message about the last text put into a scene from here (with its Undo), while it may still show. */
let lastPut: number | null = null

/** The nearest scrolling box around an element (the writing page's). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/**
 * Added below: the caret goes to the start of the new text, and the page shows the scene break above it
 * a little way down (rather than the top of the scene).
 */
function showAdded(editor: Editor, firstNew: number): void {
  const view = editor.view
  const doc = view.state.doc
  if (firstNew <= 0 || firstNew >= doc.childCount) return
  let pos = 0
  for (let i = 0; i < firstNew; i++) pos += doc.child(i).nodeSize
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos + 1))))
    const breakAt = pos - doc.child(firstNew - 1).nodeSize
    const el = view.nodeDOM(breakAt)
    if (!(el instanceof HTMLElement)) return
    const scroller = scrollerOf(el)
    if (!scroller) return
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    scroller.scrollTop = Math.max(0, top - scroller.clientHeight * 0.25)
  } catch {
    // The page is as replaceScene left it: the top of the scene.
  }
}

/**
 * Puts the blocks into the scene, in place of its text or below it (`mode`; a scene with no words just
 * takes them), then shows the writing page. `what` names them in the message ("Variant 2"). Returns
 * false (and changes nothing) when the scene can't take them right now, saying why.
 */
export async function putInScene(
  sceneId: ID,
  blocks: VariantBlock[],
  mode: UseMode,
  o: { what: string; plural?: boolean; generationId?: ID | null }
): Promise<boolean> {
  const notReady = sceneNotReady(sceneId)
  if (notReady) {
    toast(notReady)
    return false
  }
  const bridge = editorBridge()!
  const filled = bridge.hasText()
  const how: UseMode = filled ? mode : 'replace'
  await snapshotBefore(sceneId, 'Before a variant', { generationId: o.generationId ?? null })
  const now = bridge.current()
  const next = sceneWith(how, blocks, now)
  if (bridge.sceneId !== sceneId || !bridge.replaceScene(sceneId, next.doc, next.text)) {
    toast(sceneNotReady(sceneId) ?? "The scene couldn't take the new text just now, so nothing went into it. Try again in a moment.")
    return false
  }
  const added = how === 'add' && filled
  if (added && bridge.editor) showAdded(bridge.editor, next.doc.content.length - blocks.length)
  requestEditorFocus(sceneId)
  useApp.getState().navigate({ kind: 'write' })
  const undo = `${modKey()}+Z`
  const it = o.plural ? 'them' : 'it'
  // The message about the text put in before goes: its Undo would bring back an older page than this one's.
  if (lastPut !== null) useToasts.getState().dismiss(lastPut)
  lastPut = toast(
    !filled
      ? `${o.what} went into the scene. ${undo} takes ${it} out again.`
      : added
        ? `${o.what} went in below the scene's text, after a scene break. ${undo} takes ${it} out again.`
        : `${o.what} took the place of the scene's text. ${undo} puts the old text back.`,
    { action: now ? { label: 'Undo', run: () => putBack(sceneId, now) } : undefined }
  )
  return true
}

/**
 * The message's Undo: the scene as it was before, whatever has happened since (as one more step, so
 * Ctrl+Z brings the new text back again).
 */
function putBack(sceneId: ID, before: { doc: unknown; text: string }): void {
  const app = useApp.getState()
  const bridge = editorBridge()
  if (!bridge || bridge.sceneId !== sceneId) {
    // Another scene is open: this one opens, and its old text goes back once it shows.
    requestPutBack({ sceneId, doc: before.doc, text: before.text })
    app.selectScene(sceneId)
    return
  }
  if (bridge.current()?.text === before.text) {
    toast('The scene is already as it was.')
    return
  }
  if (!bridge.replaceScene(sceneId, before.doc, before.text, { message: `The scene is back as it was. ${modKey()}+Z undoes that.` })) {
    toast(sceneNotReady(sceneId) ?? "The scene couldn't be put back just now. Try again in a moment.")
    return
  }
  requestEditorFocus(sceneId)
  if (app.view.kind !== 'write') app.navigate({ kind: 'write' })
}
