// The draft options' "Directed writing" (Adam's spec, "Directed writing (an option)": "can be turned on for one draft or
// always"): ticked when Settings › Models directs every draft; changing it here is for this scene's next draft only
// (features/director/store.ts withDirected), after which the draft options follow Settings again.
import type { ID } from '@shared/types'
import { Checkbox } from '@/components/ui'
import { useApp } from '@/lib/store'
import { setOnce, useDirector } from './store'

export function DirectedToggle({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const always = useApp((s) => s.settings?.directedWriting === true)
  const once = useDirector((s) => s.once[sceneId])
  const on = once ?? always
  return (
    <div className="-mt-1" data-directed-toggle>
      <Checkbox
        size="sm"
        checked={on}
        onChange={(v) => setOnce(sceneId, v === always ? undefined : v)}
        label={<span className="font-medium">Directed writing</span>}
        hint={
          <>
            Written a stretch at a time, with a director’s note between, and your own notes as it goes.{' '}
            {once === undefined ? (always ? 'On for every draft in Settings.' : 'For this draft only.') : 'For this draft only.'} Costs a little more.
          </>
        }
      />
    </div>
  )
}
