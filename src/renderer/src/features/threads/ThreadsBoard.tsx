// The plot threads board (milestone 3): every plot thread as seen in one story, in columns Open,
// Resolved and (when there are any) Planned, with where each was set up and paid off linked to those
// scenes. A thread open for many chapters gets a calm amber note, so nothing is forgotten. Clicking a
// thread opens its page. The ledger (World Memory Overhaul B4) lists the same threads as rows: status, the scene that
// last touched each, and how many scenes it has been quiet, sortable by that.
import { ChevronDown, ChevronUp, Hourglass, Spool, Plus, Sparkles, Undo2 } from '@/components/ui/icons'
import { useState } from 'react'
import type { ID } from '@shared/types'
import type { BoardPlace, BoardThread, ThreadsBoard as Board } from '@shared/contracts/worldViews'
import { Badge, Button, EmptyState, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { createEntry } from '@/features/world/entryActions'
import { Segmented } from '@/features/generate/parts'
import { StoryFilter, useViewStory, useWorldView, ViewError, ViewHeader, ViewLoading } from '@/features/timeline/viewParts'
import {
  columnsOf,
  isQuiet,
  ledgerRows,
  openFor,
  paidOffWords,
  quietWords,
  setUpWords,
  statusWords,
  type LedgerSort,
  type PlaceWords
} from './boardLogic'

const loadBoard = (storyId: ID): Promise<Board> => api.getThreadsBoard(storyId)

const openThread = (id: ID): void => useApp.getState().navigate({ kind: 'entries', entryKind: 'thread', entryId: id })

type Layout = 'board' | 'ledger'
const LAYOUTS: { value: Layout; label: string }[] = [
  { value: 'board', label: 'Board' },
  { value: 'ledger', label: 'Ledger' }
]
const LAYOUT_KEY = 'aiwrite.threads.layout'
const savedLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'ledger' ? 'ledger' : 'board'
  } catch {
    return 'board'
  }
}

export function ThreadsBoard(): React.JSX.Element {
  const [storyId, setStoryId] = useViewStory()
  const { data, error, retry } = useWorldView(storyId, loadBoard)
  const [creating, setCreating] = useState(false)
  const [layout, setLayoutState] = useState<Layout>(savedLayout)
  const setLayout = (l: Layout): void => {
    setLayoutState(l)
    try {
      localStorage.setItem(LAYOUT_KEY, l)
    } catch {
      /* remembered for this visit only */
    }
  }

  const create = async (): Promise<void> => {
    setCreating(true)
    try {
      const e = await createEntry('thread')
      openThread(e.id)
    } catch (err) {
      toast(`Couldn’t create a plot thread. ${(err as Error).message}`, { tone: 'danger' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Plot threads board" subtitle="The questions and promises your story opens, and where each is paid off.">
        <StoryFilter value={storyId} onChange={setStoryId} />
        {data?.threads.length ? (
          <>
            <Segmented value={layout} onChange={setLayout} options={LAYOUTS} label="Show the plot threads as" />
            <Button icon={<Plus size={15} />} loading={creating} onClick={() => void create()}>
              New plot thread
            </Button>
          </>
        ) : null}
      </ViewHeader>
      {data ? (
        data.threads.length ? (
          layout === 'ledger' ? (
            <Ledger board={data} />
          ) : (
            <Columns board={data} />
          )
        ) : (
          <div className="flex-1 overflow-auto">
            <EmptyState
              icon={<Spool size={20} />}
              title="No plot threads yet"
              className="mt-[8vh]"
              actions={
                <Button variant="primary" icon={<Plus size={15} />} loading={creating} onClick={() => void create()}>
                  Create a plot thread
                </Button>
              }
            >
              A plot thread is a question or promise your story opens and later pays off, like “Who burned the mill?”. Make one, then mark
              the scenes that set it up and pay it off on their scene cards. As you write, the memory notes when it opens and when it is
              resolved.
            </EmptyState>
          </div>
        )
      ) : error ? (
        <ViewError what="The plot threads board" error={error} onRetry={retry} />
      ) : !storyId ? (
        <EmptyState
          icon={<Spool size={20} />}
          title="No story yet"
          className="mt-[10vh]"
          actions={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => useApp.getState().setNewStoryOpen(true)}>
              New story…
            </Button>
          }
        >
          Add a story in the binder, and its plot threads appear here.
        </EmptyState>
      ) : (
        <ViewLoading />
      )}
    </div>
  )
}

function Columns({ board }: { board: Board }): React.JSX.Element {
  const columns = columnsOf(board)
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Side by side when there is room; in a narrow window the columns wrap under each other rather than off the side. */}
      <div
        className="grid items-start gap-5 px-6 pb-10 pt-5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}
      >
        {columns.map(({ column, threads }) => (
          <section key={column.id} aria-labelledby={`board-${column.id}`} className="min-w-0">
            <header className="mb-3 flex items-baseline gap-2 px-1">
              <h2 id={`board-${column.id}`} className="text-[14px] font-semibold text-fg">
                {column.title}
              </h2>
              <span className="text-[12.5px] tabular-nums text-faint">{threads.length}</span>
              <span className="ml-auto truncate text-[12px] text-faint">{column.hint}</span>
            </header>
            {threads.length ? (
              <ul className="flex flex-col gap-2.5">
                {threads.map((t) => (
                  <li key={t.id}>
                    <ThreadCard thread={t} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-faint">{column.none}</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

function ThreadCard({ thread: t }: { thread: BoardThread }): React.JSX.Element {
  const setUp = setUpWords(t.setUp)
  const paidOff = paidOffWords(t.paidOff)
  const open = openFor(t)
  const [undoing, setUndoing] = useState(false)
  // The memory resolved it on its own (2026-10-08): Undo opens it again, and the same words won't resolve it again.
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
  return (
    // The whole card opens the thread for the mouse; the name is the button for the keyboard.
    <div
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) openThread(t.id)
      }}
      className={cn(
        'group cursor-pointer rounded-xl border bg-surface px-4 py-3 shadow-soft transition-colors duration-150 hover:border-line-strong',
        // The New look: a card of paper edged in the plot threads' moss ink, lifting a little on hover.
        'look-new:rounded-card look-new:border-transparent look-new:bg-page look-new:shadow-[var(--elev-1),inset_3px_0_0_var(--k-thread),inset_0_0_0_1px_var(--line)] look-new:transition-[transform,box-shadow] look-new:duration-(--dur-quick) look-new:hover:-translate-y-0.5 look-new:hover:shadow-[var(--elev-2),inset_3px_0_0_var(--k-thread),inset_0_0_0_1px_var(--line)]',
        t.longOpen ? 'border-ai/40' : 'border-line'
      )}
    >
      <button
        type="button"
        onClick={() => openThread(t.id)}
        title="Open this plot thread"
        className="block w-full rounded text-left text-[14px] font-medium leading-snug text-fg outline-none group-hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t.name}
      </button>
      {t.promise ? <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted">{t.promise}</p> : null}
      <div className="mt-2.5 flex flex-col gap-0.5 text-[12.5px] text-muted">
        <Place words={setUp} />
        {paidOff ? <Place words={paidOff} /> : null}
      </div>
      {t.resolved?.quote ? (
        <blockquote
          className="mt-2 border-l-2 border-line-strong pl-2.5 text-[12.5px] italic leading-relaxed text-muted"
          title="The words that paid it off"
          data-testid="thread-payoff"
        >
          “{t.resolved.quote}”
        </blockquote>
      ) : null}
      {/* Who made it: the memory, from the text, or Adam; and who resolved it, with Undo for the memory's resolve. */}
      <div className="mt-2.5 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        {t.aiMade ? (
          <Badge tone="ai" className="gap-1">
            <Sparkles size={11} aria-hidden />
            Found by AI
          </Badge>
        ) : (
          <span className="text-[12px] text-faint">Yours</span>
        )}
        {t.resolved?.byAi ? <span className="text-[12px] text-faint">· Resolved by AI</span> : null}
        {t.resolved?.undoId ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Undo2 size={13} />}
            loading={undoing}
            className="ml-auto"
            title="Open this plot thread again"
            onClick={() => void undoResolve(t.resolved!.undoId!)}
          >
            Undo
          </Button>
        ) : null}
      </div>
      {t.longOpen && open ? (
        <Badge tone="ai" className="mt-2.5 gap-1">
          <Hourglass size={12} aria-hidden />
          {open}
        </Badge>
      ) : open ? (
        <p className="mt-2 text-[12px] text-faint">{open}</p>
      ) : null}
    </div>
  )
}

/**
 * The open threads ledger (B4): one row a thread, with its status, the scene that last touched it and how many scenes it
 * has been quiet. Sorted by quiet-for (the quietest first) or by name; a quiet open thread gets a calm amber note.
 */
function Ledger({ board }: { board: Board }): React.JSX.Element {
  const [sort, setSort] = useState<LedgerSort>('quiet')
  const [ascending, setAscending] = useState(false)
  const rows = ledgerRows(board, sort, ascending)
  const sortBy = (s: LedgerSort): void => {
    if (s === sort) setAscending((a) => !a)
    else {
      setSort(s)
      setAscending(false)
    }
  }
  const ariaSort = (s: LedgerSort): 'ascending' | 'descending' | 'none' =>
    s !== sort ? 'none' : (s === 'name') !== ascending ? 'ascending' : 'descending'
  const head = (s: LedgerSort, label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => sortBy(s)}
      className="inline-flex items-center gap-1 rounded font-medium text-muted outline-none transition-colors duration-150 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
      title={s === 'quiet' ? 'Sort by how long each has been quiet' : 'Sort by name'}
    >
      {label}
      {sort === s ? ariaSort(s) === 'ascending' ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden /> : null}
    </button>
  )
  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-10 pt-5">
      <p className="mb-3 max-w-[70ch] text-[12.5px] leading-relaxed text-muted">
        When each plot thread was last touched in the story (a clue, a step on, or a mention), and how many scenes it has been quiet
        since. The AI writer gets a gentle reminder of an open thread that has been quiet for a while.
      </p>
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-[13px]" data-testid="threads-ledger">
        <thead>
          <tr className="text-[12px]">
            <th scope="col" aria-sort={ariaSort('name')} className="border-b border-line py-2 pr-4">
              {head('name', 'Plot thread')}
            </th>
            <th scope="col" className="border-b border-line py-2 pr-4 font-medium text-muted">
              Status
            </th>
            <th scope="col" className="border-b border-line py-2 pr-4 font-medium text-muted">
              Last touched
            </th>
            <th scope="col" aria-sort={ariaSort('quiet')} className="border-b border-line py-2">
              {head('quiet', 'Quiet for')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <LedgerRow key={t.id} thread={t} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LedgerRow({ thread: t }: { thread: BoardThread }): React.JSX.Element {
  const quiet = quietWords(t)
  return (
    <tr className="align-top">
      <td className="border-b border-line py-2.5 pr-4">
        <button
          type="button"
          onClick={() => openThread(t.id)}
          title="Open this plot thread"
          className="rounded text-left font-medium leading-snug text-fg outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {t.name}
        </button>
        {t.promise ? <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{t.promise}</p> : null}
      </td>
      <td className="border-b border-line py-2.5 pr-4 text-muted">{statusWords(t)}</td>
      <td className="border-b border-line py-2.5 pr-4 text-muted">
        <PlaceLink place={t.lastTouched ?? null} />
      </td>
      <td className="whitespace-nowrap border-b border-line py-2.5 tabular-nums">
        {isQuiet(t) ? (
          <Badge tone="ai" className="gap-1">
            <Hourglass size={12} aria-hidden />
            {quiet}
          </Badge>
        ) : quiet ? (
          <span className="text-muted">{quiet}</span>
        ) : (
          <span className="text-faint" aria-label="Not open">
            —
          </span>
        )}
      </td>
    </tr>
  )
}

/** A place on the story's line, linked to its scene; "Not yet" when nothing has touched the thread. */
function PlaceLink({ place }: { place: BoardPlace | null }): React.JSX.Element {
  if (!place) return <span className="text-faint">Not yet</span>
  const { sceneId, storyId } = place
  if (!sceneId || !storyId) return <span>{place.label || 'Before the story begins'}</span>
  return (
    <button
      type="button"
      onClick={() => useApp.getState().selectScene(sceneId, storyId)}
      title="Open this scene"
      className="rounded text-left font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {place.label}
    </button>
  )
}

/** "Set up in Book 1, Ch 3, Sc 2", with the place a link to that scene. */
function Place({ words }: { words: PlaceWords }): React.JSX.Element {
  const link = words.link
  return (
    <p className="break-words">
      {words.before}
      {link ? (
        <button
          type="button"
          onClick={() => useApp.getState().selectScene(link.sceneId, link.storyId)}
          title="Open this scene"
          className="rounded font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {words.place}
        </button>
      ) : (
        words.place
      )}
    </p>
  )
}
