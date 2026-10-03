// The plot threads board (milestone 3): every plot thread as seen in one story, in columns Open,
// Resolved and (when there are any) Planned, with where each was set up and paid off linked to those
// scenes. A thread open for many chapters gets a calm amber note, so nothing is forgotten. Clicking a
// thread opens its page.
import { Hourglass, Spool, Plus } from '@/components/ui/icons'
import { useState } from 'react'
import type { ID } from '@shared/types'
import type { BoardThread, ThreadsBoard as Board } from '@shared/contracts/worldViews'
import { Badge, Button, EmptyState, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { createEntry } from '@/features/world/entryActions'
import { StoryFilter, useViewStory, useWorldView, ViewError, ViewHeader, ViewLoading } from '@/features/timeline/viewParts'
import { columnsOf, openFor, paidOffWords, setUpWords, type PlaceWords } from './boardLogic'

const loadBoard = (storyId: ID): Promise<Board> => api.getThreadsBoard(storyId)

const openThread = (id: ID): void => useApp.getState().navigate({ kind: 'entries', entryKind: 'thread', entryId: id })

export function ThreadsBoard(): React.JSX.Element {
  const [storyId, setStoryId] = useViewStory()
  const { data, error, retry } = useWorldView(storyId, loadBoard)
  const [creating, setCreating] = useState(false)

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
          <Button icon={<Plus size={15} />} loading={creating} onClick={() => void create()}>
            New plot thread
          </Button>
        ) : null}
      </ViewHeader>
      {data ? (
        data.threads.length ? (
          <Columns board={data} />
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
  return (
    // The whole card opens the thread for the mouse; the name is the button for the keyboard.
    <div
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) openThread(t.id)
      }}
      className={cn(
        'group cursor-pointer rounded-xl border bg-surface px-4 py-3 shadow-soft transition-colors duration-150 hover:border-line-strong',
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
