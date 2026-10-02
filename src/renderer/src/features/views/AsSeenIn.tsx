// "As seen in": the story whose line entry pages and the relationship map are seen along. Shown
// only once the world has a side story, prequel or own version (spec, Story info views); until then
// every story sees the same history and there is nothing to choose.
import type { ID } from '@shared/types'
import { Select } from '@/components/ui'
import { useApp } from '@/lib/store'
import { hasOtherKinds } from './asOfLogic'

export function AsSeenIn({ value, onChange, className }: { value: ID | null; onChange: (storyId: ID) => void; className?: string }): React.JSX.Element | null {
  const stories = useApp((s) => s.stories)
  if (!hasOtherKinds(stories)) return null
  return (
    <label className={className}>
      <span className="mb-1 block text-[11.5px] font-medium text-muted">As seen in</span>
      <Select
        value={value}
        onChange={(v) => v && onChange(v)}
        options={[...stories].sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder).map((s) => ({ value: s.id, label: s.title }))}
      />
    </label>
  )
}
