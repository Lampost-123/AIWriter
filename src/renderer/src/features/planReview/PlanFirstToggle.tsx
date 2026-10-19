// The draft options' "Show me the plan first" (src/main/plan/review.ts): ticked when Settings › Models shows every plan
// first; changing it here is for this scene's next draft only (store.ts takeShowPlan), after which the draft options
// follow Settings again. It needs Plan before writing: with that off there is no plan to show.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { setShowPlanOnce, usePlanReview } from './store'

export function PlanFirstToggle({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const always = useApp((s) => s.settings?.showPlanFirst === true)
  const planning = useApp((s) => s.settings?.planFirst ?? true)
  const once = usePlanReview((s) => s.once[sceneId])
  const on = planning && (once ?? always)
  return (
    <label className={`-mt-1 flex items-start gap-2.5 ${planning ? 'cursor-pointer' : 'cursor-default opacity-60'}`} data-plan-first-toggle>
      <input
        type="checkbox"
        checked={on}
        disabled={!planning}
        onChange={(e) => setShowPlanOnce(sceneId, e.target.checked === always ? undefined : e.target.checked)}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-fg">Show me the plan first</span>
        <span className="block text-[12px] leading-relaxed text-faint">
          {planning
            ? `The AI stops once it has planned the scene, so you can read the plan, change it, then write. No extra cost. ${
                once === undefined && always ? 'On for every draft in Settings.' : 'For this draft only.'
              }`
            : 'Needs Plan before writing, which is off in Settings › Models.'}
        </span>
      </span>
    </label>
  )
}
