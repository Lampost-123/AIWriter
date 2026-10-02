// Parts the three world views share (the timeline, the relationship map and the plot threads board):
// the page header, the story they are seen in, and loading a view without flashes.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ID } from '@shared/types'
import { Button, Notice, Select, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { useSlow } from '@/features/world/parts/useSlow'

/** A world view's page header: the title, a sentence on what it shows, and its controls on the right. */
export function ViewHeader({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  return (
    <header className="shrink-0 border-b border-line px-6 pb-3 pt-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-[220px] flex-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">{title}</h1>
          {subtitle ? <div className="mt-0.5 min-h-[20px] text-[13px] text-muted">{subtitle}</div> : null}
        </div>
        {children ? <div className="flex flex-wrap items-end gap-2">{children}</div> : null}
      </div>
    </header>
  )
}

/**
 * The story a view is seen in: the one Adam picked on this screen, or the one he is working on. A story
 * picked here is forgotten when he leaves, so the view always opens on the story he is writing.
 */
export function useViewStory(): [ID | null, (id: ID) => void] {
  const working = useApp((s) => s.storyId)
  const stories = useApp((s) => s.stories)
  const [picked, setPicked] = useState<ID | null>(null)
  const id = picked && stories.some((s) => s.id === picked) ? picked : (working ?? stories[0]?.id ?? null)
  return [id, setPicked]
}

/** The story filter on the timeline and the board. Shown once the world has more than one story. */
export function StoryFilter({
  value,
  onChange,
  className
}: {
  value: ID | null
  onChange: (id: ID) => void
  className?: string
}): React.JSX.Element | null {
  const stories = useApp((s) => s.stories)
  if (stories.length < 2) return null
  return (
    <label className={cn('w-[200px]', className)}>
      <span className="mb-1 block text-[11.5px] font-medium text-muted">Story</span>
      <Select
        value={value}
        onChange={(v) => v && onChange(v)}
        options={[...stories]
          .sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder)
          .map((s) => ({ value: s.id, label: s.title }))}
      />
    </label>
  )
}

export interface ViewData<T> {
  data: T | null
  error: string | null
  retry: () => void
}

/**
 * Loads a view for a story, and again whenever the outline, the world's entries, the memory or a scene
 * card changes. The last answer stays on screen while the next one loads, so nothing flickers. `key`
 * names anything else the answer depends on (the slider's point); `pause` waits that long first, so
 * dragging a slider asks only for where it settles.
 */
export function useWorldView<T>(storyId: ID | null, load: (storyId: ID) => Promise<T>, key = '', pause = 0): ViewData<T> {
  const outlineRev = useApp((s) => s.outlineRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const briefingRev = useApp((s) => s.briefingRev)
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const ticket = useRef(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    if (!storyId) return
    const mine = ++ticket.current
    const run = (): void =>
      void loader
        .current(storyId)
        .then((data) => mine === ticket.current && setState({ data, error: null }))
        .catch((e: unknown) => mine === ticket.current && setState((s) => ({ ...s, error: plainReason(e) })))
    if (!pause) return run()
    const timer = setTimeout(run, pause)
    return () => clearTimeout(timer)
  }, [storyId, key, pause, outlineRev, entriesRev, memoryRev, briefingRev, attempt])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry }
}

/** While a view first loads: nothing, then a spinner if it takes a moment. */
export function ViewLoading(): React.JSX.Element {
  const slow = useSlow(true, 250)
  return <div className="flex flex-1 items-center justify-center text-faint">{slow ? <Spinner /> : null}</div>
}

/** A view that couldn't be loaded, with a way to try again. */
export function ViewError({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-md px-6 pt-16">
      <Notice
        tone="danger"
        action={
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {what} can't be shown right now. {error}
      </Notice>
    </div>
  )
}

/** The size of an element, kept up to date as it changes (a side panel dragged, the window resized). */
export function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void =>
      setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
