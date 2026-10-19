// Opening a scene in the page for the editor chat's changes (applyProposal.ts, applyDraft.ts), and waiting until the
// editor shows it; and why a change can't go into a scene, in plain words with what to do (Adam, 2026-10-19: "the chat
// said it could not access something to edit").
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { isHeld } from '@/features/chapterWriter/hold'

/**
 * How long to wait for a scene to open in the page before giving up. Opening first saves the open scene and stops
 * a draft running there, which can take a few seconds on a slow machine (4 s turned Apply down while it was opening).
 */
export const OPEN_WAIT_MS = 10_000

/** Write the whole chapter holds the scene: nothing may change it until the run ends (chapterWriter/hold.ts). */
export const HELD_APPLY =
  'Write the chapter is writing this scene right now, so the change can’t go in yet. Apply it when the chapter is done, or stop it in the top bar first.'

/** Why a change can't go into a scene now because Write the chapter holds it; null when it doesn't. */
export const heldWhy = (sceneId: ID | null | undefined): string | null => (isHeld(sceneId) ? HELD_APPLY : null)

/** Opens a scene in the page (if it isn't) and resolves once the editor shows it; null if it didn't in time. */
export async function sceneInPage(sceneId: ID, storyId?: ID | null, waitMs = OPEN_WAIT_MS): Promise<NonNullable<ReturnType<typeof editorBridge>>['editor']> {
  const app = useApp.getState()
  if (app.view.kind !== 'write' || app.sceneId !== sceneId) app.selectScene(sceneId, storyId ?? undefined)
  const until = Date.now() + waitMs
  for (;;) {
    const b = editorBridge()
    if (b?.sceneId === sceneId && b.editor && !b.editor.isDestroyed) return b.editor
    if (Date.now() > until) return null
    await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * Why a scene didn't open for a change, in plain words: it was deleted (or put in Recently deleted) since the chat
 * proposed the change, or it is taking longer than usual to open. Never throws.
 */
export async function notOpened(sceneId: ID, sceneLabel: string): Promise<string> {
  try {
    await api.getScene(sceneId)
  } catch {
    return `${sceneLabel} isn’t in the story any more (it may have been deleted), so the change can’t go in. If you want it back, look in Settings › Recently deleted.`
  }
  return `${sceneLabel} is taking longer than usual to open, so the change wasn’t made. Try Apply again in a moment.`
}
