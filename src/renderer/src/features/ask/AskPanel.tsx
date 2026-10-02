// Ask the world: the chat beside the page that can see the memory, cites the entries it used, and saves a
// useful answer to the memory as Adam's own note in one click. Shown in the right-hand panel in place of
// the scene panel's tabs while askOpen (layout/Inspector.tsx). Owned by the Ask the world part.
// Groundwork stand-in.
import { MessagesSquare } from 'lucide-react'
import type { ID } from '@shared/types'
import { EmptyState } from '@/components/ui'

export function AskPanel(_props: { sceneId: ID | null; onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full items-start justify-center px-4 pt-[12vh]">
      <EmptyState icon={<MessagesSquare size={20} />} title="Ask the world">
        Ask anything about your world here.
      </EmptyState>
    </div>
  )
}
