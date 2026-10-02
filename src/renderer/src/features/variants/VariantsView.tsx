// The Variants page (View 'variants'): 2 or 3 drafts of a scene side by side, to pick one or take
// paragraphs from each. Owned by the Variants part. Groundwork stand-in.
import { Columns3 } from 'lucide-react'
import type { ID } from '@shared/types'
import { EmptyState } from '@/components/ui'

export function VariantsView(_props: { sceneId: ID }): React.JSX.Element {
  return (
    <div className="flex h-full items-start justify-center pt-[16vh]">
      <EmptyState icon={<Columns3 size={20} />} title="Variants">
        Two or three drafts of this scene will show here side by side.
      </EmptyState>
    </div>
  )
}
