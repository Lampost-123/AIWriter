// The way back from a variant's "What the AI saw" to the Variants page it was opened from. Only a
// record opened from a column there goes back to the variants, and only until Adam goes elsewhere (an
// entry opened from the record leads back to it, so that keeps the way back too). A variant's record
// opened any other way, from the Drafts tab say, or one of an older set, goes back as any draft's does.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'

/** The variant's record opened from the Variants page, and the scene whose variants they are. */
let opened: { generationId: ID; sceneId: ID } | null = null
let watching = false

/** Opens a variant's "What the AI saw" from its column, so its Back returns to the variants. */
export function openVariantRecord(sceneId: ID, generationId: ID): void {
  if (!watching) {
    watching = true
    useApp.subscribe((s, prev) => {
      if (!opened || s.view === prev.view) return
      const v = s.view
      const id = opened.generationId
      const onRecord = (v.kind === 'generation' && v.generationId === id) || (v.kind === 'entries' && v.from?.generationId === id)
      if (!onRecord) opened = null
    })
  }
  opened = { generationId, sceneId }
  useApp.getState().navigate({ kind: 'generation', generationId })
}

/** The scene whose Variants page this record was opened from (Back returns there), else null. */
export const variantsBackTo = (generationId: ID): ID | null => (opened?.generationId === generationId ? opened.sceneId : null)
