// What the AI is doing, in the Plan hub's words: the lamp on the desk (planning.css draws it there), the amber pulse in
// the panels (the builders' WritingStatus): the same role and words either way.
import { WritingStatus } from '@/features/builder/parts'
import { useDesk } from '@/features/look/look'
import { LampStatus } from '@/features/planning/LampThinking'

export function HubStatus({ text, size = 22 }: { text: string; size?: number }): React.JSX.Element {
  const desk = useDesk()
  return desk ? <LampStatus text={text} size={size} /> : <WritingStatus text={text} />
}
