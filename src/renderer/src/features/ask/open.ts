// Opening Ask the world beside the page (from the top bar or the palette). Owned by the Ask the world part.
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { useApp } from '@/lib/store'

export function openAsk(): void {
  const a = useApp.getState()
  if (a.view.kind !== 'write') {
    if (a.sceneId) requestEditorFocus(a.sceneId)
    a.navigate({ kind: 'write' })
  }
  a.setAskOpen(true)
}
