// The Consistency page's controls (milestone 5): Check this story with its menu, or a running check's progress and Stop;
// a tab's count; and the thin bar under the header while this story is being checked. Shared by the page as the panels
// and Classic show it (ConsistencyView.tsx) and the desk's Check room (DeskConsistency.tsx).
import * as M from '@radix-ui/react-dropdown-menu'
import { ChevronDown, SearchCheck, Square } from '@/components/ui/icons'
import { ALL_CHECKS, DONE_CHECKS } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { runWords } from './CheckLine'
import { checkStory, stopCheck, useChecks } from './checkStore'

/** A tab's count. Room is kept for it, so the tabs don't move when it arrives; nothing shows for none. */
export function Count({ n, danger }: { n: number | null; danger?: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums',
        n ? (danger ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted') : 'invisible'
      )}
    >
      {n || 0}
    </span>
  )
}

/**
 * Check this story (facts, knowledge and timeline), with a small menu to take in voice and style too; or,
 * while a check runs, its progress and Stop. Both take the same width, so nothing beside them moves.
 */
export function CheckControls({ storyId, className }: { storyId: ID; className?: string }): React.JSX.Element {
  const run = useChecks((s) => s.run)
  if (run) {
    return (
      <div className={cn('flex h-8 w-[320px] items-center justify-end gap-2.5', className)} role="status">
        <span className="min-w-0 truncate text-[13px] text-muted" title={runWords(run)}>
          {run.storyId === storyId ? runWords(run) : `${runWords(run, true)}, in another story`}
        </span>
        <Button icon={<Square size={12} />} loading={run.stopping} onClick={() => void stopCheck()}>
          Stop
        </Button>
      </div>
    )
  }
  return (
    <div className={cn('flex h-8 w-[320px] items-center justify-end', className)}>
      <Button variant="primary" className="rounded-r-none" icon={<SearchCheck size={15} />} onClick={() => void checkStory(storyId, DONE_CHECKS)}>
        Check this story
      </Button>
      <M.Root modal={false}>
        <M.Trigger asChild>
          <Button variant="primary" aria-label="More ways to check this story" className="rounded-l-none border-l border-accent-fg/25 px-2">
            <ChevronDown size={15} />
          </Button>
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="end"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 w-[300px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
          >
            <CheckItem
              title="Facts, knowledge and timeline"
              hint="What each scene is checked for when you mark it done."
              onSelect={() => void checkStory(storyId, DONE_CHECKS)}
            />
            <CheckItem
              title="Voice and style too"
              hint="Also each character’s voice, point of view, tense and tone. Slower, and costs more."
              onSelect={() => void checkStory(storyId, ALL_CHECKS)}
            />
          </M.Content>
        </M.Portal>
      </M.Root>
    </div>
  )
}

function CheckItem({ title, hint, onSelect }: { title: string; hint: string; onSelect: () => void }): React.JSX.Element {
  return (
    <M.Item onSelect={onSelect} className="flex flex-col rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2">
      <span className="text-[13.5px] font-medium text-fg">{title}</span>
      <span className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</span>
    </M.Item>
  )
}

/** A thin bar along the foot of the header while this story is being checked: how far it has got. */
export function RunBar({ storyId }: { storyId: ID }): React.JSX.Element | null {
  const run = useChecks((s) => (s.run?.storyId === storyId ? s.run : null))
  if (!run) return null
  // Until the first scene starts there is nothing to measure: the bar starts from the left, never shrinks back.
  const share = run.total && run.done !== null ? Math.min(1, run.done / run.total) : 0
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
      <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, share * 100)}%` }} />
    </div>
  )
}
