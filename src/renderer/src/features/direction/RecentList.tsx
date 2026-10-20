// The directions given before, in a popover from a direction box (features/direction/DirectionComposer.tsx): a search
// box, the starred ones, then the recent ones, newest first. Picking one puts it in the box (after what is there);
// the star keeps one for every story. Keyboard: the search box first, ↓ and ↑ move through the list, Enter picks.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search, Star } from '@/components/ui/icons'
import type { RecentDirection } from '@shared/contracts/direction'
import { cn } from '@/lib/cn'
import { directionKey } from '@shared/directions'
import { relativeTime } from '@/features/generate/format'
import { searchDirections, SOURCE_WORDS } from './logic'
import { isFavourite, setFavourite, useDirections } from './store'

/** One direction in the list: pick it (its words, and where and when it was given), or star it. */
function Row({
  text,
  meta,
  starred,
  onPick,
  onStar
}: {
  text: string
  meta: string | null
  starred: boolean
  onPick: (text: string) => void
  onStar: (text: string, on: boolean) => void
}): React.JSX.Element {
  return (
    <li className="group flex items-start gap-0.5 rounded-lg transition-colors duration-150 hover:bg-surface-2 focus-within:bg-surface-2">
      <button
        type="button"
        data-direction-pick=""
        onClick={() => onPick(text)}
        title="Use this direction"
        className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]"
      >
        <span className="line-clamp-2 text-[13px] leading-[1.45] text-fg">{text}</span>
        {meta ? <span className="mt-0.5 block text-[11.5px] leading-4 text-faint">{meta}</span> : null}
      </button>
      <button
        type="button"
        aria-pressed={starred}
        data-star-key={directionKey(text)}
        aria-label={starred ? `Take the star off “${text}”` : `Star “${text}”`}
        title={starred ? 'Starred: kept for every story. Click to take the star off.' : 'Star it, to keep it for every story'}
        onClick={() => onStar(text, !starred)}
        className={cn(
          'mt-1 mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-[color,opacity,background-color] duration-150 hover:bg-surface-3 focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]',
          starred ? 'text-accent' : 'text-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        )}
      >
        <Star size={14} selected={starred} fill={starred ? 'currentColor' : 'none'} aria-hidden />
      </button>
    </li>
  )
}

const metaOf = (d: RecentDirection, now: number): string =>
  `${SOURCE_WORDS[d.source]} · ${relativeTime(d.at, now)}${d.uses > 1 ? ` · ${d.uses} times` : ''}`

export function RecentList({
  recents,
  onPick,
  heading
}: {
  recents: RecentDirection[]
  onPick: (text: string) => void
  /** Above the search box (the desk's dock puts the quick asks there). */
  heading?: React.ReactNode
}): React.JSX.Element {
  const favourites = useDirections((s) => s.favourites)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const now = useMemo(() => Date.now(), [])

  const starred = useMemo(() => searchDirections(favourites.map((text) => ({ text })), query), [favourites, query])
  const recent = useMemo(
    () => searchDirections(recents.filter((r) => !isFavourite(favourites, r.text)), query),
    [recents, favourites, query]
  )
  const asked = query.trim() !== ''

  // A star given or taken away moves its direction between the lists: the keyboard follows it to its new place.
  const refocus = useRef<string | null>(null)
  const star = (text: string, on: boolean): void => {
    refocus.current = directionKey(text)
    void setFavourite(text, on)
  }
  useLayoutEffect(() => {
    const key = refocus.current
    if (!key) return
    refocus.current = null
    if (document.activeElement && document.activeElement !== document.body && listRef.current?.contains(document.activeElement)) return
    const target = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-star-key]') ?? [])].find((el) => el.dataset.starKey === key)
    target?.focus({ preventScroll: true })
  }, [favourites])

  /** ↓ and ↑ through the directions (from the search box into the list, and back up to it from the first). */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const picks = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-direction-pick]') ?? [])]
    if (!picks.length) return
    const at = picks.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'ArrowDown') picks[at < 0 ? 0 : Math.min(at + 1, picks.length - 1)].focus()
    else if (at <= 0) searchRef.current?.focus()
    else picks[at - 1].focus()
  }

  return (
    <div onKeyDown={onKeyDown}>
      {heading}
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          data-direction-search=""
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your directions"
          aria-label="Search your directions"
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full rounded-md border border-line bg-page pl-8 pr-2.5 text-[13px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <div ref={listRef} className="-mx-1 mt-2 max-h-[min(300px,45vh)] overflow-y-auto px-1">
        {starred.length ? (
          <section aria-label="Starred">
            <h4 className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Starred</h4>
            <ul>
              {starred.map((d) => (
                <Row key={`s:${d.text}`} text={d.text} meta={null} starred onPick={onPick} onStar={star} />
              ))}
            </ul>
          </section>
        ) : null}
        {recent.length ? (
          <section aria-label="Recent" className={cn(starred.length && 'mt-2')}>
            <h4 className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Recent</h4>
            <ul>
              {recent.map((d) => (
                <Row key={`r:${d.text}`} text={d.text} meta={metaOf(d, now)} starred={false} onPick={onPick} onStar={star} />
              ))}
            </ul>
          </section>
        ) : null}
        {!starred.length && !recent.length ? (
          <p className="px-2.5 py-3 text-[12.5px] leading-relaxed text-muted">
            {asked
              ? `No directions with “${query.trim()}” in them.`
              : 'Directions you give the AI show here, newest first, so you can use them again.'}
          </p>
        ) : null}
      </div>
    </div>
  )
}
