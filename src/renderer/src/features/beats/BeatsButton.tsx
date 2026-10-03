// The Beat by beat button in the scene toolbar (milestone 4): writes the scene one beat of its card at a
// time, pausing after each so Adam can steer the next (see flow.ts). Pressed in while the scene has a
// session on, when it puts the keyboard in the bar. What it asks before starting shows under it.
import * as P from '@radix-ui/react-popover'
import { ListOrdered } from '@/components/ui/icons'
import { useRef } from 'react'
import type { ID } from '@shared/types'
import { ToolButton } from '@/features/editor/ToolButton'
import { dismissQuestion } from './flow'
import { QuestionPanel } from './parts'
import { useBeats } from './session'
import { startBeatByBeat } from './start'

export function BeatsButton({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const on = useBeats((s) => s.session?.sceneId === sceneId)
  const question = useBeats((s) => (s.question?.sceneId === sceneId && s.question.from === 'button' ? s.question : null))
  /** The question was open when the button was pressed: the press closes it (rather than asking again). */
  const wasOpen = useRef(false)
  return (
    <P.Root open={!!question} onOpenChange={(open) => !open && dismissQuestion()}>
      <P.Anchor asChild>
        <ToolButton
          icon={<ListOrdered size={15} />}
          label="Beat by beat"
          active={on}
          title={
            on
              ? 'Beat by beat is on: steer and write each beat from the bar at the bottom of the page'
              : 'Beat by beat: write the scene one beat of its card at a time, and steer before each one'
          }
          onPointerDown={() => {
            wasOpen.current = !!question
          }}
          onClick={(e) => {
            if (wasOpen.current) {
              wasOpen.current = false
              return
            }
            // Enter or Space on the button (no pointer): asked from the keyboard.
            startBeatByBeat(sceneId, { byKey: e.detail === 0 })
          }}
        />
      </P.Anchor>
      {question ? <QuestionPanel key={question.kind} question={question} side="bottom" /> : null}
    </P.Root>
  )
}
