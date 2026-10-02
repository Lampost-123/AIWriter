// Taking a snapshot of the open scene before something changes it (milestone 4, Drafts and history):
// every AI change (a draft, a beat, a picked variant, an accepted AI edit) and every restore. Other parts
// call snapshotBefore() just before their change goes into the page. History is a convenience: this never
// fails loudly and never holds the change up for long.
import type { ID } from '@shared/types'
import type { SnapshotInfo, TakeSnapshotInput } from '@shared/contracts/history'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'

/** The change goes ahead after this long even if the snapshot hasn't been kept yet (it still is, a moment later). */
const WAIT_AT_MOST_MS = 1500

/**
 * Keeps the scene as the page shows it now (Adam's unsaved typing included). Does nothing when the page
 * isn't showing that scene. Resolves with the snapshot (the latest one when it already has this text), or
 * null when nothing was kept (an empty page, history out of reach) or keeping it is taking too long.
 */
export async function snapshotBefore(
  sceneId: ID,
  label: string,
  o: { kind?: TakeSnapshotInput['kind']; generationId?: ID | null } = {}
): Promise<SnapshotInfo | null> {
  const now = editorBridge()?.current()
  if (!now || now.sceneId !== sceneId) return null
  const kept = api
    .takeSnapshot({ sceneId, kind: o.kind ?? 'ai', label, generationId: o.generationId ?? null, doc: now.doc, text: now.text })
    .catch((e: unknown) => {
      console.error('Could not keep a snapshot of the scene', e)
      return null
    })
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WAIT_AT_MOST_MS)
  })
  try {
    return await Promise.race([kept, late])
  } finally {
    clearTimeout(timer)
  }
}
