// Restoring an earlier version of a scene (the History page's Restore): the page as it is now is kept
// first ("Before restoring"), then the earlier version takes its place as one step Ctrl+Z takes back,
// and Adam is back on the writing page. The restored text is saved straight away and the memory reads
// it then (memoryFollows), as it does after a switch of drafts.
import type { ID } from '@shared/types'
import type { Snapshot } from '@shared/contracts/history'
import { toast } from '@/components/ui'
import { api, modKey } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { snapshotBefore } from './snapshot'

/**
 * Another version of the scene went into the page (a restore, another draft): it is saved now, and the
 * memory reads it straight away rather than after the usual pause in typing.
 */
export function memoryFollows(sceneId: ID): void {
  // Once the change that called this has gone through.
  setTimeout(() => {
    const bridge = editorBridge()
    void (bridge?.sceneId === sceneId ? bridge.flush() : Promise.resolve())
      .then(() => api.restored(sceneId))
      .catch((e: unknown) => console.warn("The memory couldn't be told the scene's text was restored", e))
  }, 0)
}

/** Puts an earlier version back in the scene. `when` names it in the message ("today at 14:05"). Returns true when it went in. */
export async function restoreSnapshot(snap: Snapshot, when: string): Promise<boolean> {
  const sceneId = snap.sceneId
  const bridge = editorBridge()
  if (!bridge || bridge.sceneId !== sceneId) {
    toast("This scene isn't open any more, so nothing was restored. Open the scene, then its History.", { tone: 'danger' })
    return false
  }
  if (bridge.busy()) {
    toast('A draft is being written into this scene. Restore this version once it has finished, or press Stop.')
    return false
  }
  const before = bridge.current()
  const beforeDoc = bridge.editor?.state.doc ?? null
  await snapshotBefore(sceneId, 'Before restoring', { kind: 'restore' })
  if (!bridge.replaceScene(sceneId, snap.doc, snap.text)) {
    toast("The page wasn't ready, so nothing was restored. Try again in a moment.", { tone: 'danger' })
    return false
  }
  const restored = bridge.editor?.state.doc ?? null
  memoryFollows(sceneId)
  // Back to the writing page, with the keyboard in the page so Ctrl+Z takes the restore back.
  requestEditorFocus(sceneId)
  useApp.getState().selectScene(sceneId)
  toast(`The version from ${when} is back in the scene. ${modKey()}+Z takes it out again.`, {
    action: {
      label: 'Undo',
      run: () => {
        const b = editorBridge()
        if (!b || b.sceneId !== sceneId) return
        // Already taken out (with Ctrl+Z, say): nothing to do.
        if (beforeDoc && b.editor?.state.doc.eq(beforeDoc)) return
        // Nothing typed since: the restore is the last step, so it is undone like Ctrl+Z. Otherwise the text
        // from before the restore comes back as a step of its own (the typing stays a Ctrl+Z away).
        if (restored && b.editor?.state.doc.eq(restored)) b.undo()
        else if (before) b.replaceScene(sceneId, before.doc, before.text)
        memoryFollows(sceneId)
      }
    }
  })
  return true
}
