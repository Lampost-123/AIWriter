// The pieces the Cast tab and the entry beside the page share: an entry's state as of the scene and a
// character's voice notes, in the same words and order in both.
import type { NamedEntry, VoiceNotes } from '@shared/contracts/manuscript'
import { cn } from '@/lib/cn'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { noStateWords, voiceRows, whereWords } from './entryView'

/** What has happened to it so far and what is true now, each with where; or why there's nothing. */
export function StateList({ entry, quiet, className }: { entry: NamedEntry; quiet?: boolean; className?: string }): React.JSX.Element {
  if (!entry.state.length || entry.absent) {
    return <p className={cn('text-[12.5px] leading-[19px] text-faint', className)}>{noStateWords(entry)}</p>
  }
  return (
    <ul className={cn('space-y-0.5', className)}>
      {entry.state.map((l, i) => (
        <li key={i} className={cn('text-[12.5px] leading-[19px]', quiet ? 'text-muted' : 'text-fg')}>
          {l.text}
          {whereWords(l) ? <span className={l.here ? 'text-accent' : 'text-faint'}> · {whereWords(l)}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/** How a character speaks: the voice fields as labelled rows, then a few sample lines in the prose font. */
export function VoiceList({
  voice,
  samples = 2,
  className
}: {
  voice: VoiceNotes | null
  samples?: number
  className?: string
}): React.JSX.Element | null {
  const { rows, samples: lines } = voiceRows(voice, samples)
  if (!rows.length && !lines.length) return null
  return (
    <div className={cn('space-y-1', className)}>
      {rows.map((r) => (
        <p key={r.label} className="text-[12.5px] leading-[19px] text-fg">
          <span className="text-faint">{r.label}: </span>
          {r.text}
        </p>
      ))}
      {lines.map((l, i) => (
        <p key={i} className="border-l-2 border-line pl-2 font-serif text-[13px] italic leading-[19px] text-muted">
          “{l}”
        </p>
      ))}
    </div>
  )
}

/** Grey shapes where a list will be, shown only when loading takes a while (nothing flashes on a quick load). */
export function ListLoading({ rows = 3 }: { rows?: number }): React.JSX.Element {
  const slow = useDelayed(true, 250)
  return (
    <div aria-busy className={cn('flex flex-col gap-4 px-4 pt-4 transition-opacity duration-150', slow ? 'opacity-100' : 'opacity-0')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
