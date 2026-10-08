// The plot threads on the desk (UI overhaul, "the AI planning pages"; Adam: the threads board needs a rework). The same
// threads, columns and actions as the board in the panels (ThreadsBoard.tsx, boardLogic.ts), drawn as a loom: the
// story's chapters along a ruler, and each thread a strand across it in its own colour (the story board's string inks):
// a knot where it is set up, beads where scenes touch it, a tied knot where it is paid off, or a fraying, glowing end
// while it is still open (the longer it has been open, the brighter). Strands draw themselves in; a pay-off knot ties
// itself. Under the loom, each thread as a card: its drawing, who found it, what it promises, where it is set up and
// paid off (each a jump to the scene), the words that paid it off, how long it has been open, and its actions: open it,
// show it on the story board, plan its pay-off with the AI, Undo the memory's resolve. Filters by chapter and by
// words; the header band has the threads weaving and the counts. Fills a big screen: the loom across the page, the
// cards in as many columns as fit.
import * as M from '@radix-ui/react-dropdown-menu'
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BoardSceneCard, BoardThread, ThreadsBoard as Board } from '@shared/contracts/worldViews'
import type { ID, Outline } from '@shared/types'
import { ArrowUpRight, Check, Hourglass, Plus, Search, Sparkles, Spool, StickyNote, Undo2 } from '@/components/ui/icons'
import { Button, Select, toast } from '@/components/ui'
import { Motif } from '@/components/art/Motif'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useWidth } from '@/features/builder/parts'
import { useBoardStore } from '@/features/desk/board/boardStore'
import { threadsIn, useBoardData } from '@/features/desk/board/StoryBoard'
import { PlanArt } from '@/features/planning/PlanArt'
import { PlanBand } from '@/features/planning/PlanShell'
import { useDealDelay } from '@/features/planning/deal'
import { StoryFilter } from '@/features/timeline/viewParts'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { columnsOf, openFor, paidOffWords, setUpWords, type PlaceWords } from './boardLogic'
import { loomRuler, matchesWords, openMarks, sceneWords, strandOf, touchesChapter, type LoomRuler, type Strand } from './loomLogic'
import { markPaidOff } from './payOff'
import './threads.css'

const openThread = (id: ID): void => useApp.getState().navigate({ kind: 'entries', entryKind: 'thread', entryId: id })

const LABEL_W = 280
const ROW_H = 46
const HEAD_H = 58

export interface DeskThreadsProps {
  storyId: ID | null
  setStoryId: (id: ID) => void
  data: Board | null
  /** What to show while there is no board: an error, no story, or loading. */
  fallback: React.ReactNode
  creating: boolean
  create: () => void
}

export function DeskThreads({ storyId, setStoryId, data, fallback, creating, create }: DeskThreadsProps): React.JSX.Element {
  const outlineRev = useApp((s) => s.outlineRev)
  const briefingRev = useApp((s) => s.briefingRev)
  const outline = useBoardData<Outline>(() => (storyId ? api.getOutline(storyId) : null), [storyId, outlineRev])
  const cards = useBoardData<Record<ID, BoardSceneCard>>(() => (storyId ? api.listSceneCards(storyId) : null), [storyId, outlineRev, briefingRev])
  const threads = data?.threads ?? []
  const counts = { open: threads.filter((t) => t.column === 'open').length, resolved: threads.filter((t) => t.column === 'resolved').length, planned: threads.filter((t) => t.column === 'planned').length }
  const longest = Math.max(0, ...threads.map((t) => (t.column === 'open' ? (t.openChapters ?? 0) : 0)))

  return (
    <div className="plan-page th-page" data-plan-page="threads">
      <PlanBand
        art="threads"
        kicker="Plan"
        kickerIcon={Spool}
        title="Plot threads"
        line="The questions and promises your story opens, and where each is paid off: each thread a strand across the story, from the scene that sets it up to the scene that answers it."
      >
        {data && threads.length ? (
          <dl className="th-stats" aria-label="Plot threads by where they stand">
            <div className="is-open">
              <dt>Open</dt>
              <dd>{counts.open}</dd>
            </div>
            <div className="is-resolved">
              <dt>Resolved</dt>
              <dd>{counts.resolved}</dd>
            </div>
            {counts.planned ? (
              <div className="is-planned">
                <dt>Planned</dt>
                <dd>{counts.planned}</dd>
              </div>
            ) : null}
            {longest ? <p className="th-stats-note">The longest open: {longest === 1 ? '1 chapter' : `${longest} chapters`}</p> : null}
          </dl>
        ) : null}
      </PlanBand>
      {data ? (
        threads.length ? (
          <Loaded board={data} outline={outline} cards={cards} storyId={storyId} setStoryId={setStoryId} creating={creating} create={create} />
        ) : (
          <div className="th-scroll">
            <div className="th-empty">
              <PlanArt name="threads" className="th-empty-art" />
              <p className="plan-empty-t">No plot threads yet</p>
              <p className="plan-empty-s">
                A plot thread is a question or promise your story opens and later pays off, like “Who burned the mill?” Make one, then mark the scenes
                that set it up and pay it off on their scene cards. As you write, the memory notes when it opens and when it is resolved.
              </p>
              <div className="mt-5 flex items-center gap-2">
                <StoryFilter value={storyId} onChange={setStoryId} />
                <Button variant="primary" size="lg" icon={<Plus size={15} />} loading={creating} onClick={create}>
                  Create a plot thread
                </Button>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="th-scroll flex flex-col">{fallback}</div>
      )}
    </div>
  )
}

function Loaded({
  board,
  outline,
  cards,
  storyId,
  setStoryId,
  creating,
  create
}: {
  board: Board
  outline: Outline | null
  cards: Record<ID, BoardSceneCard> | null
  storyId: ID | null
  setStoryId: (id: ID) => void
  creating: boolean
  create: () => void
}): React.JSX.Element {
  const loomRef = useRef<HTMLDivElement>(null)
  const width = useWidth(loomRef)
  const ruler = useMemo(() => loomRuler(outline, LABEL_W + 24, Math.max(LABEL_W + 260, width - 56)), [outline, width])
  const touches = useMemo(() => new Map(threadsIn(board, cards).map((t) => [t.id, t.sceneIds])), [board, cards])
  const ink = useMemo(() => new Map(board.threads.map((t, i) => [t.id, (i % 6) + 1])), [board])
  const [chapter, setChapter] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [hover, setHover] = useState<ID | null>(null)
  const current = useApp((s) => s.storyId)
  const onBoard = !!storyId && storyId === current

  // The story's scenes in reading order, for "Mark paid off".
  const scenes = useMemo(() => {
    const titles = new Map((outline?.scenes ?? []).map((sc) => [sc.id, sc.title.trim()]))
    return ruler.chapters.flatMap((c) => c.scenes.map((sc, k) => ({ id: sc.id, where: `Ch ${c.n}, Sc ${k + 1}`, title: titles.get(sc.id) || 'Untitled scene' })))
  }, [ruler, outline])
  const chosen = ruler.chapters.find((c) => c.id === chapter) ?? null
  const shown = board.threads.filter((t) => matchesWords(t, words) && (!chosen || touchesChapter(t, chosen, touches.get(t.id))))
  const shownIds = new Set(shown.map((t) => t.id))
  const filtered: Board = { ...board, threads: shown }
  const columns = columnsOf(filtered)

  return (
    <div className="th-scroll">
      <div className="th-tools">
        <StoryFilter value={storyId} onChange={setStoryId} className="th-tool" />
        <label className="th-tool w-[230px]">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">Chapter</span>
          <Select
            value={chapter}
            allowNone
            noneLabel="Every chapter"
            onChange={setChapter}
            options={ruler.chapters.map((c) => ({ value: c.id, label: `Ch ${c.n}${c.title ? ` · ${c.title}` : ''}` }))}
          />
        </label>
        <label className="th-tool th-find">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">Find</span>
          <span className="th-find-box">
            <Search size={14} aria-hidden />
            <input value={words} placeholder="A word in a thread’s name or promise" onChange={(e) => setWords(e.target.value)} aria-label="Find a plot thread" />
          </span>
        </label>
        <span className="flex-1" />
        <Button icon={<Plus size={15} />} loading={creating} onClick={create}>
          New plot thread
        </Button>
      </div>

      <section className="th-loom" ref={loomRef} aria-label="The threads across the story">
        {width ? <Loom ruler={ruler} threads={board.threads} shown={shownIds} touches={touches} ink={ink} hover={hover} setHover={setHover} chapter={chosen?.id ?? null} /> : null}
      </section>

      {shown.length ? (
        <div className="th-sections">
          {columns.map(({ column, threads }) => (
            <section key={column.id} aria-labelledby={`th-${column.id}`} className="th-section">
              <header className="th-section-head">
                <h2 id={`th-${column.id}`}>{column.title}</h2>
                <span className="th-count">{threads.length}</span>
                <span className="th-hint">{column.hint}</span>
              </header>
              {threads.length ? (
                <ul className="th-cards">
                  {[...threads]
                    .sort((a, b) => Number(b.longOpen) - Number(a.longOpen))
                    .map((t) => (
                      <li key={t.id}>
                        <ThreadCard
                          thread={t}
                          ruler={ruler}
                          ink={ink.get(t.id) ?? 1}
                          lit={hover === t.id}
                          dim={!!hover && hover !== t.id}
                          setHover={setHover}
                          onBoard={onBoard}
                          storyId={storyId}
                          scenes={scenes}
                        />
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="th-none">{column.none}</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <p className="th-none mt-6">No plot thread here matches. Choose every chapter, or find other words.</p>
      )}
    </div>
  )
}

/** The loom: the chapters along a ruler, each thread a strand across it. */
function Loom({
  ruler,
  threads,
  shown,
  touches,
  ink,
  hover,
  setHover,
  chapter
}: {
  ruler: LoomRuler
  threads: BoardThread[]
  shown: Set<ID>
  touches: Map<ID, ID[]>
  ink: Map<ID, number>
  hover: ID | null
  setHover: (id: ID | null) => void
  chapter: ID | null
}): React.JSX.Element {
  const rows = threads.filter((t) => shown.has(t.id))
  const height = HEAD_H + Math.max(1, rows.length) * ROW_H + 18
  const width = ruler.right + 32
  return (
    <div className="th-loom-in" style={{ height }}>
      {/* The ruler: each chapter's band, its numeral and title, and its scenes as ticks. */}
      {ruler.chapters.map((c, i) => (
        <div
          key={c.id}
          className={cn('th-chap', i % 2 && 'is-alt', chapter === c.id && 'is-on')}
          style={{ left: c.x, width: c.w, height } as CSSProperties}
          aria-hidden
        >
          <span className="th-chap-n">{toRoman(c.n)}</span>
          <span className="th-chap-t">{c.title || `Chapter ${c.n}`}</span>
        </div>
      ))}
      <svg className="th-strands" width={width} height={height} aria-hidden>
        <defs>
          <radialGradient id="th-open-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.75" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        {ruler.chapters.flatMap((c) =>
          c.scenes.map((s) => <line key={s.id} x1={s.x} x2={s.x} y1={HEAD_H - 12} y2={HEAD_H - 4} className="th-tick" />)
        )}
        {rows.map((t, i) => (
          <StrandRow
            key={t.id}
            strand={strandOf(t, ruler, touches.get(t.id))}
            y={HEAD_H + i * ROW_H + ROW_H / 2}
            n={i}
            ink={ink.get(t.id) ?? 1}
            right={ruler.right}
            lit={hover === t.id}
            dim={!!hover && hover !== t.id}
          />
        ))}
      </svg>
      {/* Each row's name: the way in for the keyboard, and it picks its strand out. */}
      {rows.map((t, i) => {
        const strand = strandOf(t, ruler, touches.get(t.id))
        return (
          <button
            key={t.id}
            type="button"
            className={cn('th-row', hover === t.id && 'is-lit', hover && hover !== t.id && 'is-dim')}
            style={{ top: HEAD_H + i * ROW_H, height: ROW_H, width: ruler.right + 20, '--ink': `var(--thread-${ink.get(t.id) ?? 1})` } as CSSProperties}
            onPointerEnter={() => setHover(t.id)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(t.id)}
            onBlur={() => setHover(null)}
            onClick={() => openThread(t.id)}
            title={`Open “${t.name}”`}
          >
            <span className="th-row-name">{t.name}</span>
            <span className={cn('th-row-state', `is-${t.column}`)}>{t.column === 'resolved' ? 'Resolved' : t.column === 'planned' ? 'Planned' : 'Open'}</span>
            {strand.from === null && strand.to === null ? <span className="th-row-off">Not in this story’s scenes yet</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** A gentle wave from a to b at height y: a thread, not a rule. */
function wave(a: number, b: number, y: number, phase: number): string {
  const n = Math.max(1, Math.round((b - a) / 46))
  const step = (b - a) / n
  let d = `M${a.toFixed(1)} ${y}`
  for (let i = 0; i < n; i++) {
    const x0 = a + i * step
    const dy = (i + phase) % 2 ? 2.4 : -2.4
    d += ` Q${(x0 + step / 2).toFixed(1)} ${(y + dy).toFixed(1)} ${(x0 + step).toFixed(1)} ${y}`
  }
  return d
}

function StrandRow({ strand: s, y, n, ink, right, lit, dim }: { strand: Strand; y: number; n: number; ink: number; right: number; lit: boolean; dim: boolean }): React.JSX.Element | null {
  if (s.from === null && s.to === null) return null
  const a = s.from ?? (s.to as number)
  const end = s.open ? right - 14 : (s.to ?? a)
  const d = wave(a, Math.max(a + 1, end), y, n % 2)
  const style = { color: `var(--thread-${ink})`, '--d': `${180 + n * 90}ms` } as CSSProperties
  return (
    <g className={cn('th-strand', s.planned && 'is-planned', lit && 'is-lit', dim && 'is-dim')} style={style}>
      <path d={d} className="th-s-halo" />
      <path d={d} className="th-s-main" pathLength={s.planned ? undefined : 1} />
      <path d={d} className="th-s-twist" />
      {s.from !== null ? (
        <g className="th-k-set">
          <circle cx={s.from} cy={y} r={5} />
          <circle cx={s.from} cy={y} r={2} className="th-k-hole" />
        </g>
      ) : null}
      {s.beads.map((x) => (
        <circle key={x} cx={x} cy={y} r={3.2} className="th-bead" />
      ))}
      {!s.open && s.to !== null ? (
        <g className="th-k-paid" style={{ transformOrigin: `${s.to}px ${y}px` }}>
          <circle cx={s.to} cy={y} r={5.5} />
          <path d={`M${s.to - 3.5} ${y + 4} q -3 6 -9 7`} pathLength={1} />
        </g>
      ) : null}
      {s.open ? (
        <g className="th-fray">
          <circle cx={end} cy={y} r={10 + s.tension * 14} fill="url(#th-open-glow)" className="th-fray-glow" style={{ opacity: 0.3 + s.tension * 0.6 } as CSSProperties} />
          <path d={`M${end} ${y} l 9 -5 M${end} ${y} l 11 0 M${end} ${y} l 9 5`} />
        </g>
      ) : null}
    </g>
  )
}

const toRoman = (n: number): string => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'][n - 1] ?? String(n)

function ThreadCard({
  thread: t,
  ruler,
  ink,
  lit,
  dim,
  setHover,
  onBoard,
  storyId,
  scenes
}: {
  thread: BoardThread
  ruler: LoomRuler
  ink: number
  lit: boolean
  dim: boolean
  setHover: (id: ID | null) => void
  onBoard: boolean
  storyId: ID | null
  /** The story's scenes in reading order. */
  scenes: { id: ID; where: string; title: string }[]
}): React.JSX.Element {
  const deal = useDealDelay()
  const motifs = useEntryMotifs()
  const motif = motifs.get(t.id) ?? 'letter'
  const setUp = setUpWords(t.setUp)
  const paidOff = paidOffWords(t.paidOff)
  const open = openFor(t)
  const marks = openMarks(t.openChapters)
  const [undoing, setUndoing] = useState(false)
  const undoResolve = async (id: ID): Promise<void> => {
    setUndoing(true)
    try {
      await api.undoMemoryItem(id)
      toast(`“${t.name}” is open again. The memory won't resolve it again from the same words.`)
    } catch (e) {
      toast(`That couldn't be undone. ${(e as Error).message}`, { tone: 'danger' })
    } finally {
      setUndoing(false)
    }
  }
  const showOnBoard = (): void => {
    if (!storyId) return
    useBoardStore.setState({ focusThread: t.id })
    useApp.getState().navigate({ kind: 'board', storyId })
  }
  const planPayOff = (): void => {
    if (!storyId) return
    useBoardStore.setState({ ideasWish: `Move toward paying off the plot thread “${t.name}”${t.promise ? ` (${t.promise.trim()})` : ''}.`, ideasNext: true })
    useApp.getState().navigate({ kind: 'board', storyId })
  }
  return (
    <article
      className={cn('th-card plan-deal', `is-${t.column}`, t.longOpen && 'is-long', lit && 'is-lit', dim && 'is-dim')}
      style={{ ...deal, '--ink': `var(--thread-${ink})` } as CSSProperties}
      data-thread={t.id}
      onPointerEnter={() => setHover(t.id)}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        // (A click in its Mark paid off menu, which lies outside the card, bubbles here through React: not the card's.)
        if (!e.currentTarget.contains(e.target as Node)) return
        if (!(e.target as HTMLElement).closest('button')) openThread(t.id)
      }}
    >
      <div className="th-card-top">
        <span className="th-seal" aria-hidden>
          <Motif id={motif} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" className="th-name" onClick={() => openThread(t.id)} title="Open this plot thread">
            {t.name}
          </button>
          <div className="th-chips">
            {t.aiMade ? (
              <span className="th-chip is-ai">
                <Sparkles size={11} aria-hidden />
                Found by AI
              </span>
            ) : (
              <span className="th-chip">Yours</span>
            )}
            {t.resolved?.byAi ? <span className="th-chip">Resolved by AI</span> : null}
          </div>
        </div>
        <span className={cn('th-state', `is-${t.column}`)}>{t.column === 'resolved' ? 'Resolved' : t.column === 'planned' ? 'Planned' : 'Open'}</span>
      </div>
      {t.promise ? <p className="th-promise">{t.promise}</p> : null}
      <div className="th-places">
        <Place label="Set up" words={setUp} short={sceneWords(ruler, t.setUp?.sceneId)} kind="set" />
        {paidOff ? <Place label="Paid off" words={paidOff} short={sceneWords(ruler, t.paidOff?.sceneId)} kind="paid" /> : null}
      </div>
      {t.resolved?.quote ? (
        <blockquote className="th-quote" title="The words that paid it off" data-testid="thread-payoff">
          {t.resolved.quote}
        </blockquote>
      ) : null}
      {open ? (
        <div className={cn('th-meter', t.longOpen && 'is-long')} title={t.longOpen ? 'Open a long time: it may be waiting for its pay-off.' : undefined}>
          <span className="th-meter-marks" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} className={i < marks ? 'is-on' : undefined} />
            ))}
          </span>
          <span className="th-meter-l">
            {t.longOpen ? <Hourglass size={12} aria-hidden /> : null}
            {open}
          </span>
        </div>
      ) : null}
      <div className="th-actions">
        {onBoard ? (
          <button type="button" className="plan-txt th-act" onClick={showOnBoard} title="The story board, with this thread’s string picked out">
            <StickyNote size={13} aria-hidden /> On the story board
          </button>
        ) : null}
        {onBoard && t.column !== 'resolved' ? (
          <button type="button" className="plan-keep th-act" onClick={planPayOff} title="Ideas for what comes next, aimed at paying this thread off">
            <Sparkles size={13} aria-hidden /> Plan its pay-off
          </button>
        ) : null}
        {t.column === 'open' && storyId && scenes.length ? <MarkPaidOff thread={t} scenes={scenes} storyId={storyId} /> : null}
        {t.resolved?.undoId ? (
          <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} loading={undoing} title="Open this plot thread again" onClick={() => void undoResolve(t.resolved!.undoId!)}>
            Undo
          </Button>
        ) : null}
      </div>
    </article>
  )
}

/**
 * "Mark paid off": a short list of the scenes after the one that sets it up, the latest first; picking one opens its card
 * with this thread under Pays off (payOff.ts).
 */
function MarkPaidOff({ thread: t, scenes, storyId }: { thread: BoardThread; scenes: { id: ID; where: string; title: string }[]; storyId: ID }): React.JSX.Element {
  const from = scenes.findIndex((sc) => sc.id === t.setUp?.sceneId)
  const after = (from >= 0 ? scenes.slice(from + 1) : scenes).slice().reverse()
  return (
    <M.Root modal={false}>
      <M.Trigger className="plan-txt th-act" title="Choose the scene that pays it off: its card opens with this thread under Pays off">
        <Check size={13} aria-hidden /> Mark paid off
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[260px] max-w-[360px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Paid off in</M.Label>
          {after.length ? (
            after.map((sc) => (
              <M.Item
                key={sc.id}
                onSelect={() => markPaidOff({ sceneId: sc.id, threadId: t.id, name: t.name }, storyId)}
                className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2"
              >
                <span className="w-[74px] shrink-0 text-[12px] tabular-nums text-faint">{sc.where}</span>
                <span className="min-w-0 flex-1 truncate">{sc.title}</span>
              </M.Item>
            ))
          ) : (
            <p className="px-2 py-1.5 text-[12.5px] text-muted">No scene comes after the one that sets it up yet.</p>
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/** "Set up · Ch 2, Sc 1 ↗": a jump to the scene. */
function Place({ label, words, short, kind }: { label: string; words: PlaceWords; short: string | null; kind: 'set' | 'paid' }): React.JSX.Element {
  const link = words.link
  const planned = words.before.startsWith('To be')
  return (
    <div className={cn('th-place', `is-${kind}`)}>
      <span className="th-place-k" aria-hidden>
        {kind === 'set' ? (
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="4.5" fill="var(--ink)" />
            <circle cx="7" cy="7" r="1.6" fill="var(--card)" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="6" r="3.6" stroke="var(--ink)" strokeWidth="1.6" fill="var(--card)" />
            <path d="M5 9 q -1.5 3 -4 3.4" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="th-place-l">{planned ? `To be ${label.toLowerCase()}` : label}</span>
      {link ? (
        <button
          type="button"
          onClick={() => useApp.getState().selectScene(link.sceneId, link.storyId)}
          title={`Open this scene: ${words.place}`}
          className="th-jump"
        >
          {short ?? words.place}
          <ArrowUpRight size={12} aria-hidden />
        </button>
      ) : (
        <span className="th-place-w">{words.place || words.before.trim()}</span>
      )}
    </div>
  )
}
