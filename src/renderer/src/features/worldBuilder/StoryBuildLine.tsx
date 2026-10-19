// The story's cast being built, where Adam plans it (2026-10-19): once a Keep has started building the story's
// characters and places (storyBuild.ts), the outline helper's page, a chapter's plan and the Story builder's outline say
// so, with what it is doing now, See progress and Stop, rather than leaving it to a toast that goes or to Generate's
// "Write now / Wait" much later. Draws nothing while nothing is waiting or building for this story.
import type { ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { WritingStatus } from '@/features/builder/parts'
import { openWorldBuilder } from './open'
import { stopStoryBuild, useStoryBuild } from './storyBuild'

export function StoryBuildLine({ storyId, className }: { storyId: ID; className?: string }): React.JSX.Element | null {
  const waiting = useStoryBuild((s) => s.waiting.includes(storyId))
  const running = useStoryBuild((s) => (s.running?.storyId === storyId ? s.running : null))
  if (!waiting && !running) return null
  const text = running
    ? `Building the story’s characters and places${running.step ? `: ${running.step}` : '…'}`
    : 'Building the story’s characters and places in a moment…'
  const link =
    'shrink-0 rounded text-[12.5px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40'
  return (
    <div className={cn('flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1', className)} data-story-build>
      <WritingStatus text={text} />
      <button type="button" className={link} onClick={() => openWorldBuilder()}>
        See progress
      </button>
      {running ? (
        <button type="button" className={link} onClick={stopStoryBuild} title="Stop building. What was made so far stays.">
          Stop
        </button>
      ) : null}
    </div>
  )
}
