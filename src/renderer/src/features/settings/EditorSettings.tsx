// Settings › Editor (writing by hand): the few switches for writing by hand, together. Each part fills
// its own section: spelling (features/spelling), typing (features/typing), the daily word target
// (features/goals) and Show beats (features/beats).
import { SpellingSettings } from '@/features/spelling/SpellingSettings'
import { TypingSettings } from '@/features/typing/TypingSettings'
import { GoalSettings } from '@/features/goals/GoalSettings'
import { BeatSettings } from '@/features/beats/BeatSettings'

export function EditorSettings(): React.JSX.Element {
  return (
    <div className="flex max-w-md flex-col gap-8">
      <SpellingSettings />
      <TypingSettings />
      <GoalSettings />
      <BeatSettings />
    </div>
  )
}
