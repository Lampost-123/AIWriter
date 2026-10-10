// Write the whole chapter holds the scenes it works on: open in the page, one of them can be read but not typed in
// (dimmed, as a draft waiting to replace the words is), so the editor never saves over the AI's words; each change the
// run makes shows in the page at once. The page lets go when the run ends.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { ID } from '@shared/types'
import { editorBridge } from '@/lib/editorBridge'

const holdKey = new PluginKey('aiwriteChapterHold')

let held = new Set<ID>()
/** True while the run's own change goes into the page (it alone may change held words). */
let applying = false

const holdsOpen = (): boolean => {
  const id = editorBridge()?.sceneId
  return !!id && held.has(id)
}

/** True while the chapter writer is working on this scene. */
export const isHeld = (sceneId: ID | null | undefined): boolean => !!sceneId && held.has(sceneId)

/** The scenes the run works on now (none once it ends); the page takes or lets go of the open one at once. */
export function setHeld(sceneIds: ID[]): void {
  const next = new Set(sceneIds)
  if (next.size === held.size && [...next].every((id) => held.has(id))) return
  held = next
  const editor = editorBridge()?.editor
  if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(holdKey, true))
}

/** A held scene's new words, shown in the page if it is the open one. */
export function showRunChange(sceneId: ID, doc: unknown, text: string): void {
  const bridge = editorBridge()
  if (!bridge || bridge.sceneId !== sceneId) return
  applying = true
  try {
    bridge.replaceScene(sceneId, doc, text)
  } finally {
    applying = false
  }
}

export const ChapterHold = Extension.create({
  name: 'aiwriteChapterHold',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: holdKey,
      filterTransaction: (tr) => !(tr.docChanged && !applying && holdsOpen()),
      props: {
        editable: () => !holdsOpen(),
        attributes: (): Record<string, string> => (holdsOpen() ? { class: 'chapter-held' } : {})
      }
    })
  ]
})
