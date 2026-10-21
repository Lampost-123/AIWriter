// The draft options' "Show me the plan first" (src/main/plan/review.ts): ticked when Settings › Models shows every plan
// first; changing it here is for this scene's next draft only (store.ts takeShowPlan), after which the draft options
// follow Settings again. It needs Plan before writing: with that off there is no plan to show.
import type { ID } from '@shared/types'
import { Checkbox } from '@/components/ui'
import { useApp } from '@/lib/store'
import { setShowPlanOnce, usePlanReview } from './store'

export function PlanFirstToggle({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const always = useApp((s) => s.settings?.showPlanFirst === true)
  const planning = useApp((s) => s.settings?.planFirst ?? true)
  const once = usePlanReview((s) => s.once[sceneId])
  const on = planning && (once ?? always)
  return (
    <div className="-mt-1" data-plan-first-toggle>
      <Checkbox
        size="sm"
        checked={on}
        disabled={!planning}
        onChange={(v) => setShowPlanOnce(sceneId, v === always ? undefined : v)}
        label={<span className="font-medium">Show me the plan first</span>}
        hint={
          planning
            ? `The AI stops once it has planned the scene, so you can read the plan, change it, then write. No extra cost. ${
                once === undefined && always ? 'On for every draft in Settings.' : 'For this draft only.'
              }`
            : 'Needs Plan before writing, which is off in Settings › Models.'
        }
      />
    </div>
  )
}
