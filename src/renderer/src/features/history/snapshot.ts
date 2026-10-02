// Taking a snapshot of the open scene before something changes it (milestone 4, Drafts and history):
// every AI change (a draft, a beat, a picked variant, an accepted AI edit) and every restore. Other parts
// call snapshotBefore() just before their change goes into the page. History is a convenience: this never
// fails loudly and never holds the change up for long.
import type { ID } from '@shared/types'
import type { TakeSnapshotInput } from '@shared/contracts/history'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'

/** Keeps the scene as the page shows it now. Does nothing when the page isn't showing that scene. */
export async function snapshotBefore(
  sceneId: ID,
  label: string,
  o: { kind?: TakeSnapshotInput['kind']; generationId?: ID | null } = {}
): Promise<void> {
  const now = editorBridge()?.current()
  if (!now || now.sceneId !== sceneId) return
  try {
    await api.takeSnapshot({ sceneId, kind: o.kind ?? 'ai', label, generationId: o.generationId ?? null, doc: now.doc, text: now.text })
  } catch (e) {
    console.error('Could not keep a snapshot of the scene', e)
  }
}
