// The outline helper (View 'outline'): from a premise, the AI suggests acts, chapters and scene cards;
// Adam keeps, edits or discards each one, and nothing is added without a click. Owned by the Outline
// part. Groundwork stand-in.
import { ListTree } from 'lucide-react'
import type { ID } from '@shared/types'
import { EmptyState } from '@/components/ui'

export function OutlineHelper(_props: { storyId: ID }): React.JSX.Element {
  return (
    <div className="flex h-full items-start justify-center pt-[16vh]">
      <EmptyState icon={<ListTree size={20} />} title="Outline helper">
        Suggested acts, chapters and scenes will show here.
      </EmptyState>
    </div>
  )
}
