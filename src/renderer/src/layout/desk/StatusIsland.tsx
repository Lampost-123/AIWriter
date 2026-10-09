// The desk's status island (top bar, right): one paper pill that changes what it says instead of crowding the bar.
// "Saved · 1,167 words" with today's target ring; "Writing… 212 words" while a draft writes (a click goes back to a
// draft writing into another scene); "Memory · 2 changes" for a moment after the memory keeper changed something (a
// click opens What changed). Clicking it otherwise shows the word counts and today's writing. The pill's visible width
// is a clip-path, so it changes smoothly without moving anything (layout/desk/desk.css), and the words cross-fade.
// islandState.ts decides what it says.
import * as P from '@radix-ui/react-popover'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { PopoverPanel } from '@/features/generate/parts'
import { dayOf } from '@/features/goals/goalLogic'
import { useGoals } from '@/features/goals/goalStore'
import { onOpenWordCounts, WordCountsBody } from '@/features/goals/WordCounts'
import { freshUpdate } from '@/features/memory/logic'
import { openScene } from '@/features/memory/openScene'
import { changesText, islandState, wordsText, type IslandShows } from './islandState'

/** How long the memory's news shows before the island says Saved again. */
const MEMORY_FOR = 8000

/** The tick that draws itself, as the mockup's. */
function Tick({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={cn('isl-tick', className)} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
    </svg>
  )
}

/** Today's target as a small ring (only with a target set). */
function GoalRing({ share }: { share: number }): React.JSX.Element {
  const r = 7
  const around = 2 * Math.PI * r
  return (
    <svg className="isl-ring" width={18} height={18} viewBox="0 0 18 18" aria-hidden>
      <circle cx={9} cy={9} r={r} className="gr-track" />
      <circle cx={9} cy={9} r={r} className={cn('gr-fill', share >= 1 && 'is-met')} strokeDasharray={around} strokeDashoffset={around * (1 - share)} />
    </svg>
  )
}

/** The words written into the open scene by the draft now writing (its count when it started, then the difference). */
function useDraft(): { here: boolean; written: number | null } | null {
  const draft = useApp((s) => s.activeGeneration)
  const sceneId = useApp((s) => s.sceneId)
  const onPage = useApp((s) => s.view.kind === 'write')
  const words = useApp((s) => s.sceneWords)
  const base = useRef<{ id: ID; words: number } | null>(null)
  if (!draft) base.current = null
  else if (base.current?.id !== draft.id) base.current = { id: draft.id, words }
  if (!draft) return null
  const here = onPage && draft.sceneId === sceneId
  return { here, written: here && base.current ? words - base.current.words : null }
}

/** The memory keeper's latest changes, for a few seconds after they land (only changes made since this world opened). */
function useMemoryNews(): { changes: number; runId: ID } | null {
  const status = useApp((s) => s.memoryStatus)
  const worldId = useApp((s) => s.world?.id ?? null)
  const opened = useRef({ worldId, at: Date.now() - 2000 })
  if (opened.current.worldId !== worldId) opened.current = { worldId, at: Date.now() - 2000 }
  const [seen, setSeen] = useState<ID | null>(null)
  const news = freshUpdate(status, seen, opened.current.at)
  useEffect(() => {
    if (!news) return
    const t = setTimeout(() => setSeen(news.runId), MEMORY_FOR)
    return () => clearTimeout(t)
  }, [news?.runId])
  return news
}

export function StatusIsland(): React.JSX.Element {
  const saveState = useApp((s) => s.saveState)
  const onPage = useApp((s) => s.view.kind === 'write')
  const sceneWords = useApp((s) => s.sceneWords)
  const daily = useApp((s) => s.settings?.goals?.daily ?? null)
  const navigate = useApp((s) => s.navigate)
  const days = useGoals((s) => s.days) ?? []
  const today = useGoals((s) => s.today)
  const draft = useDraft()
  const draftScene = useApp((s) => s.activeGeneration?.sceneId ?? null)
  const memory = useMemoryNews()
  const island = islandState({ saveState, onPage, sceneWords, draft, memory, daily, typedToday: dayOf(days, today).typed })
  const [open, setOpen] = useState(false)
  useEffect(() => onOpenWordCounts(() => setOpen(true)), [])

  // Each state's words are all there, stacked at the right; the pill shows as wide as the one showing.
  const labels = useRef<Partial<Record<IslandShows, HTMLSpanElement | null>>>({})
  const [widths, setWidths] = useState<Partial<Record<IslandShows, number>>>({})
  useLayoutEffect(() => {
    const measure = (): void => {
      const next: Partial<Record<IslandShows, number>> = {}
      for (const [k, el] of Object.entries(labels.current)) if (el) next[k as IslandShows] = Math.ceil(el.scrollWidth)
      setWidths((w) => (JSON.stringify(w) === JSON.stringify(next) ? w : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const el of Object.values(labels.current)) if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const widest = Math.max(120, ...Object.values(widths).map((w) => w ?? 0))
  const shown = widths[island.shows] ?? widest

  // Saved's tick draws itself each time something is saved.
  const [saves, setSaves] = useState(0)
  useEffect(() => {
    if (saveState === 'saved') setSaves((n) => n + 1)
  }, [saveState])

  const label = (key: IslandShows, children: React.ReactNode): React.JSX.Element => (
    <span
      ref={(el) => {
        labels.current[key] = el
      }}
      aria-hidden={island.shows !== key}
      data-on={island.shows === key || undefined}
      className="isl-label"
    >
      {children}
    </span>
  )

  const what =
    island.shows === 'writing'
      ? island.written !== null
        ? `Writing… ${wordsText(island.written)}`
        : 'Writing… Click to go back to the scene it is writing into.'
      : island.shows === 'memory'
        ? `Memory · ${changesText(island.changes)}. Click to see what changed.`
        : island.shows === 'unsaved'
          ? 'Not saved, retrying'
          : island.shows === 'saving'
            ? 'Saving…'
            : `Saved${island.words !== null ? ` · ${wordsText(island.words)}` : ''}. Click for the word counts and today’s writing.`

  const onClick = (e: React.MouseEvent): void => {
    if (island.shows === 'writing' && !draft?.here && draftScene) {
      e.preventDefault()
      if (draftScene === useApp.getState().sceneId) navigate({ kind: 'write' })
      else void openScene(draftScene)
    } else if (island.shows === 'memory') {
      e.preventDefault()
      navigate({ kind: 'memory', sceneId: null })
    }
  }

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger
        data-desk-island={island.shows}
        title={what}
        aria-label={what}
        // A click leaves the caret (and any selection) in the page.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className="desk-island relative h-8 shrink-0 rounded-full outline-none"
        style={{ width: widest }}
      >
        <span aria-hidden className="isl-bg" style={{ clipPath: `inset(0 0 0 ${Math.max(0, widest - shown)}px round 999px)` }} />
        {label(
          'saved',
          <>
            <Tick key={saves} className="text-success" />
            <b>Saved</b>
            {island.words !== null ? (
              <>
                <span className="isl-sep" />
                <span className="tabular-nums">{wordsText(island.words)}</span>
              </>
            ) : null}
            {island.goalShare !== null && island.words !== null ? (
              <>
                <GoalRing share={island.goalShare} />
                <span className="isl-pct tabular-nums">{island.goalPercent}%</span>
              </>
            ) : null}
          </>
        )}
        {label('saving', <span className="text-muted">Saving…</span>)}
        {label(
          'unsaved',
          <>
            <span className="h-2 w-2 rounded-full bg-danger" />
            <span className="text-danger">Not saved, retrying</span>
          </>
        )}
        {label(
          'writing',
          <>
            <span className="isl-dot" />
            <span>
              Writing…
              {island.written !== null ? (
                <>
                  {' '}
                  <b className="tabular-nums">{island.written.toLocaleString('en-GB')}</b> {island.written === 1 ? 'word' : 'words'}
                </>
              ) : null}
            </span>
          </>
        )}
        {label(
          'memory',
          <>
            <Tick className="text-success" />
            <span>
              Memory · <b>{changesText(island.changes)}</b>
            </span>
          </>
        )}
      </P.Trigger>
      <PopoverPanel
        className="w-[300px]"
        align="end"
        // The caret (and any selection) stays in the page while the counts show.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <WordCountsBody open={open} />
      </PopoverPanel>
    </P.Root>
  )
}
