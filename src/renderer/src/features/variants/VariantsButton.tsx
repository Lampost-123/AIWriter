// The Variants button in the scene toolbar: opens the Variants page, where 2 or 3 drafts of the scene are
// written side by side, to use one or take paragraphs from each. While they are being written (perhaps
// with Adam on another page or scene), a small amber light on the button says so.
import { Columns3 } from '@/components/ui/icons'
import { useEffect } from 'react'
import type { ID } from '@shared/types'
import { ToolButton } from '@/features/editor/ToolButton'
import { openVariants } from './open'
import { ensureListening, isWriting, setOf, useVariants } from './store'

export function VariantsButton({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const writing = useVariants((s) => isWriting(setOf(s, sceneId)))
  useEffect(ensureListening, [])
  return (
    <ToolButton
      icon={
        <span className="relative flex">
          <Columns3 size={15} />
          {writing ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-ai ring-2 ring-page animate-pulse" /> : null}
        </span>
      }
      label="Variants"
      title={
        writing
          ? 'Variants: being written now. Open them to watch, stop them or pick one.'
          : 'Variants: write two or three drafts of this scene side by side, then use the one you like or take paragraphs from each'
      }
      onClick={() => openVariants(sceneId)}
    />
  )
}
