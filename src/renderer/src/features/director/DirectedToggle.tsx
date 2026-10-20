// The draft options' "Directed writing" (Adam's spec, "Directed writing (an option)": "can be turned on for one draft or
// always"): ticked when Settings › Models directs every draft; changing it here is for this scene's next draft only
// (features/director/store.ts withDirected), after which the draft options follow Settings again.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { setOnce, useDirector } from './store'

export function DirectedToggle({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const always = useApp((s) => s.settings?.directedWriting === true)
  const once = useDirector((s) => s.once[sceneId])
  const on = once ?? always
  return (
    <label className="-mt-1 flex cursor-pointer items-start gap-2.5" data-directed-toggle>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setOnce(sceneId, e.target.checked === always ? undefined : e.target.checked)}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-fg">Directed writing</span>
        <span className="block text-[12px] leading-relaxed text-faint">
          Written a stretch at a time, with a director’s note between, and your own notes as it goes.{' '}
          {once === undefined ? (always ? 'On for every draft in Settings.' : 'For this draft only.') : 'For this draft only.'} Costs a little more.
        </span>
      </span>
    </label>
  )
}
