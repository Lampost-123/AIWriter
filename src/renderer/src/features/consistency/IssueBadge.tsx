// The binder's issue badges (milestone 5): a small count of open issues on a scene's row, and on a
// folded chapter's row the total of its scenes. Red only when one of them must be fixed, otherwise a
// quiet neutral (amber marks AI suggestions). Each badge reads the counts itself, so the binder's rows
// don't re-render for them; it sits after the title, so the title and word count never move.
import type { ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { countWords, useChecks, type IssueCount } from './checkStore'

function Badge({ n }: { n: IssueCount }): React.JSX.Element {
  const words = countWords(n)
  return (
    <span className="ml-1.5 flex shrink-0 items-center" title={words}>
      <span
        aria-hidden
        className={cn(
          'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10.5px] font-semibold leading-none tabular-nums',
          n.mustFix ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-muted'
        )}
      >
        {n.count > 99 ? '99+' : n.count}
      </span>
      <span className="sr-only">, {words}</span>
    </span>
  )
}

/** A scene's open issues, or nothing. */
export function SceneIssueBadge({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const n = useChecks((s) => s.counts.byScene[sceneId])
  return n && n.count > 0 ? <Badge n={n} /> : null
}

/** A folded chapter's scenes' open issues together, or nothing. */
export function ChapterIssueBadge({ chapterId }: { chapterId: ID }): React.JSX.Element | null {
  const count = useChecks((s) => s.counts.byScene)
  const scenes = useOutlineStore((s) => s.outline?.scenes)
  let total = 0
  let mustFix = 0
  for (const sc of scenes ?? []) {
    if (sc.chapterId !== chapterId) continue
    total += count[sc.id]?.count ?? 0
    mustFix += count[sc.id]?.mustFix ?? 0
  }
  return total > 0 ? <Badge n={{ count: total, mustFix }} /> : null
}
