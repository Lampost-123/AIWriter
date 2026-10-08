// Settings › Recently deleted in the New look: what was deleted as cards, by the day it went, each with a small drawing
// of what it is (a page for a scene, a stack of pages for a chapter or an act, a book for a story, the kind's own tile
// for a world entry), where it was, when it went, and a ring of the 30 days it is kept (how many are left). Restore
// brings it back: the card lifts away (140 ms) and the list closes up; a toast says so, with Open. The list keeps
// Classic's names (one list "Recently deleted", each card's "Restore “…”"), so it behaves the same.
import { RotateCcw, type IconType } from '@/components/ui/icons'
import type { DeletedItem } from '@shared/types'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { KIND_ICONS, KIND_INK } from '@/features/world/kindIcons'
import { clockTime, dayLabel, daysLeft } from './backupText'

const KEEP_DAYS = 30

/** A small drawing of what was deleted. */
function Drawing({ d }: { d: DeletedItem }): React.JSX.Element {
  if (d.kind === 'entry') {
    const Icon: IconType | undefined = d.entryKind ? KIND_ICONS[d.entryKind] : undefined
    return (
      <span aria-hidden className={cn('dl-tile', d.entryKind ? KIND_INK[d.entryKind].tile : 'bg-surface-2 text-muted')}>
        {Icon ? <Icon size={18} /> : null}
      </span>
    )
  }
  if (d.kind === 'story') {
    return (
      <span aria-hidden className="dl-book">
        <i />
      </span>
    )
  }
  // A scene is one page; a chapter or an act, a few pages fanned.
  return (
    <span aria-hidden className={cn('dl-page', d.kind !== 'scene' && 'is-stack')}>
      <i />
      <i />
      <i />
    </span>
  )
}

/** The 30 days it is kept, as a ring that empties: the days left in the middle. */
function DaysRing({ left }: { left: number }): React.JSX.Element {
  const R = 13
  const C = 2 * Math.PI * R
  const share = Math.min(1, left / KEEP_DAYS)
  return (
    <span className="relative grid h-[34px] w-[34px] shrink-0 place-items-center" title={`Kept for ${left} more day${left === 1 ? '' : 's'}`}>
      <svg aria-hidden viewBox="0 0 34 34" className="absolute inset-0">
        <circle cx="17" cy="17" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="3" />
        <circle
          cx="17"
          cy="17"
          r={R}
          fill="none"
          stroke={left <= 5 ? 'var(--k-event)' : 'var(--accent)'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${share * C} ${C}`}
          transform="rotate(-90 17 17)"
        />
      </svg>
      <span className="text-[10.5px] font-semibold tabular-nums text-fg">{left}</span>
    </span>
  )
}

export function DeletedCards({
  items,
  restoring,
  leaving,
  titleOf,
  whereOf,
  onRestore
}: {
  items: DeletedItem[]
  restoring: string | null
  leaving: string | null
  titleOf: (d: DeletedItem) => string
  whereOf: (d: DeletedItem) => string
  onRestore: (d: DeletedItem) => void
}): React.JSX.Element {
  // The days they went, in order (newest first, as listed).
  const groups: { day: string; items: DeletedItem[] }[] = []
  for (const d of items) {
    const day = dayLabel(d.deletedAt)
    const g = groups[groups.length - 1]
    if (g && g.day === day) g.items.push(d)
    else groups.push({ day, items: [d] })
  }
  return (
    <div className="@container animate-fade-in">
      <p className="mb-4 text-[12.5px] text-muted">
        {items.length} {items.length === 1 ? 'thing' : 'things'} waiting. Each is removed for good {KEEP_DAYS} days after it was deleted; the ring
        shows the days left.
      </p>
      <ul aria-label="Recently deleted" className="flex flex-col">
        {groups.map((g) =>
          g.items.map((d, i) => {
            const title = titleOf(d)
            const left = daysLeft(d.deletedAt)
            return (
              <li key={`${d.kind}:${d.id}`} className={cn('dl-item', i === 0 && 'is-first', leaving === d.id && 'is-leaving')}>
                {i === 0 ? (
                  <p aria-hidden className="dl-day">
                    {g.day}
                  </p>
                ) : null}
                <div className="dl-card flex items-center gap-3.5 px-3.5 py-3">
                  <Drawing d={d} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading text-[15.5px] font-semibold text-fg" title={title}>
                      {title}
                    </p>
                    <p className="truncate text-[12px] text-muted">
                      {whereOf(d)}
                      <span className="px-1.5 text-faint">·</span>
                      Deleted at {clockTime(d.deletedAt)}
                    </p>
                  </div>
                  <DaysRing left={left} />
                  <Button
                    size="sm"
                    icon={<RotateCcw size={13} />}
                    loading={restoring === d.id}
                    disabled={!!restoring}
                    onClick={() => onRestore(d)}
                    aria-label={`Restore “${title}”`}
                  >
                    Restore
                  </Button>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
