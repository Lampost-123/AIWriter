// "Listen from here" in the bar over selected words (features/editor/selection/SelectionLayer.tsx), when
// read aloud is on. Owned by the Read aloud part. Reading starts at the first selected word.
import type { Editor } from '@tiptap/core'
import { Headphones } from 'lucide-react'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { BarButton } from '@/features/editor/selection/SelectionLayer'
import { listenFrom } from './control'

export function ListenFromHere({
  editor,
  sceneId,
  from
}: {
  editor: Editor
  sceneId: ID
  from: number
  to: number
}): React.JSX.Element | null {
  const on = useApp((s) => !!s.settings?.speech.readAloud)
  if (!on) return null
  return (
    <>
      <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
      <BarButton icon={<Headphones size={14} />} onClick={() => listenFrom(editor, sceneId, from)}>
        Listen from here
      </BarButton>
    </>
  )
}
