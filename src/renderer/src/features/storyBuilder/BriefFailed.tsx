// Build with AI when the story's brief couldn't be read (review #4): nothing is saved over it, and Try again reads it again.
import type { ID } from '@shared/types'
import { ListTree } from '@/components/ui/icons'
import { Button, EmptyState } from '@/components/ui'
import { loadBrief } from './store'

export function BriefFailed({ storyId }: { storyId: ID }): React.JSX.Element {
  return (
    <div className="flex h-full items-start justify-center pt-[16vh]">
      <EmptyState icon={<ListTree size={20} />} title="Couldn’t load this story’s plan" actions={<Button onClick={() => void loadBrief(storyId)}>Try again</Button>}>
        Nothing in it has changed. If it keeps happening, close AI Write and open it again.
      </EmptyState>
    </div>
  )
}
