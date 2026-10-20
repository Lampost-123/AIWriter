// "Earlier suggestions" (2026-10-19, after "Suggest again throws away what I hadn't decided on"): under the newest
// suggestions, each batch there was when Adam suggested again, as he left it, with what is still to decide. Folded
// away by default, so the new ones are what he sees first and nothing is shown twice; one click opens it. Each batch
// keeps its Keep, Edit and Discard, and "Put these away" discards what is left in it (Undo in a toast). The same on the
// outline helper's page, a chapter's plan and a recipe's plan, in both looks.

import { useMemo, useState } from 'react'
import type { ID } from '@shared/types'
import { ChevronRight } from '@/components/ui/icons'
import { Button, Fold } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { chapterHelperKey, earlierShown, helperKey, putAwayEarlier, treeOf, useOutlineHelper, type HelperRun } from './helperStore'
import { EarlierList } from './Suggestions'
import { countLine, countNodes, totalOf } from './tree'

/** "Suggested at 2:41 pm", or "Suggested earlier" for a batch with no time. */
function batchName(run: HelperRun): string {
  if (!run.at) return 'Suggested earlier'
  const t = new Date(run.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `Suggested at ${t}`
}

export function EarlierSuggestions({ storyId, chapterId = null, className }: { storyId: ID; chapterId?: ID | null; className?: string }): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id)
  const key = chapterId ? chapterHelperKey(worldId, storyId, chapterId) : helperKey(worldId, storyId)
  const session = useOutlineHelper((st) => st.sessions[key])
  const batches = useMemo(() => (session ? earlierShown(session).map((run) => ({ run, tree: treeOf(run) })) : []), [session])
  const [open, setOpen] = useState(false)
  if (!batches.length) return null
  const toDecide = batches.reduce((n, b) => n + totalOf(countNodes(b.tree, b.run.decisions, 'open')), 0)
  const what = chapterId ? 'scene cards' : 'suggestions'
  return (
    <section aria-label="Earlier suggestions" className={cn('mt-8 border-t border-line pt-4', className)} data-earlier>
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted outline-none transition-colors duration-150 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ChevronRight size={13} aria-hidden className={cn('transition-transform duration-150', open && 'rotate-90')} />
          Earlier suggestions
        </button>
        <span className="text-[12px] tabular-nums text-faint">{toDecide} still to decide</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        The {what} you hadn’t decided on when you suggested again. Nothing here goes into the story until you keep it.
        {open ? null : ' Open them to keep, change or discard any of it.'}
      </p>
      <Fold open={open}>
        <div className="mt-4 flex flex-col gap-6">
          {batches.map(({ run, tree }) => {
            const left = countNodes(tree, run.decisions, 'open')
            return (
              <div key={run.taskId} role="group" aria-label={batchName(run)} data-earlier-batch>
                <div className="mb-2.5 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-[12.5px] font-semibold text-fg">{batchName(run)}</h3>
                  <span className="text-[12px] text-faint">{countLine(left)} to decide</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => putAwayEarlier(storyId, run.taskId, chapterId)}
                    title="Discard everything still to decide in these. Undo brings them back."
                  >
                    Put these away
                  </Button>
                </div>
                <EarlierList storyId={storyId} chapterId={chapterId} run={run} tree={tree} />
              </div>
            )
          })}
        </div>
      </Fold>
    </section>
  )
}
