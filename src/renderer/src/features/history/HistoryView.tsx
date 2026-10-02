// The History page for one scene (View 'history'). Owned by the History part. Groundwork stand-in.
import { History } from 'lucide-react'
import type { ID } from '@shared/types'
import { EmptyState } from '@/components/ui'

export function HistoryView(_props: { sceneId: ID; snapshotId?: ID | null }): React.JSX.Element {
  return (
    <div className="flex h-full items-start justify-center pt-[16vh]">
      <EmptyState icon={<History size={20} />} title="Scene history">
        Earlier versions of this scene will show here.
      </EmptyState>
    </div>
  )
}
