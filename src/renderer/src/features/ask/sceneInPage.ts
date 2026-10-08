// Opening a scene in the page for the editor chat's changes (applyProposal.ts, applyDraft.ts), and waiting until the
// editor shows it.
import type { ID } from '@shared/types'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'

/** How long to wait for a scene to open in the page before giving up. */
const OPEN_WAIT_MS = 4000

/** Opens a scene in the page (if it isn't) and resolves once the editor shows it; null if it didn't in time. */
export async function sceneInPage(sceneId: ID, storyId?: ID | null): Promise<NonNullable<ReturnType<typeof editorBridge>>['editor']> {
  const app = useApp.getState()
  if (app.view.kind !== 'write' || app.sceneId !== sceneId) app.selectScene(sceneId, storyId ?? undefined)
  const until = Date.now() + OPEN_WAIT_MS
  for (;;) {
    const b = editorBridge()
    if (b?.sceneId === sceneId && b.editor && !b.editor.isDestroyed) return b.editor
    if (Date.now() > until) return null
    await new Promise((r) => setTimeout(r, 50))
  }
}
