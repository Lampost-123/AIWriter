// "What changed" in the desk's Check room (UI overhaul): the memory's ledger. The same list and actions as
// WhatChanged.tsx (which loads everything and hands it here on the desk), laid out for the sheet: down the left, a
// quill writing in an open ledger, the page's name, how the memory is doing now (reading a scene, up to date, or not
// updating and why), and what the list holds by kind (Added, Changed, Removed, To answer), each a filter with its
// count. The list is a ledger: each read of a scene a ruled page with its place and time, each change a line with the
// entry's drawing, what it was struck through and what it is now, the words it came from set as a quote with the way
// to them, the memory's question as chips, and Undo (the line is struck through as it goes, and the counts tick).
import { useRef, useState, type ReactNode } from 'react'
import type { Entry, ID, MemoryLogItem } from '@shared/types'
import type { StoryFlowRun } from '@shared/contracts/storyFlows'
import { ArrowLeft, ArrowRight, ArrowUpRight, CircleAlert, Minus, PenLine, Plus } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { LedgerArt } from '@/components/art/RoomArt'
import { TickNumber } from '@/components/ui/TickNumber'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useFlip } from '@/lib/useFlip'
import { fullDate, relativeTime } from '@/features/generate/format'
import { Skeleton } from '@/features/generate/parts'
import { EntryMark, useEntryLook } from '@/features/consistency/desk/marks'
import { beforeAfter, canUndo, groupHeading, keeperState, pointsToSettings, readingNote, wordsGone, type LogGroup } from './logic'
import '@/features/consistency/check.css'
import './ledger.css'

type Filter = 'all' | 'added' | 'updated' | 'removed' | 'asks'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'added', label: 'Added' },
  { id: 'updated', label: 'Changed' },
  { id: 'removed', label: 'Removed' },
  { id: 'asks', label: 'To answer' }
]

const keeps = (f: Filter, i: MemoryLogItem): boolean =>
  f === 'all' || (f === 'asks' ? !!i.question && !i.undone && i.question.answer === null : i.action === f)

export interface DeskLedgerProps {
  sceneId: ID | null
  sceneTitle: string | null
  backLabel: string
  items: MemoryLogItem[] | null
  groups: LogGroup[]
  error: string | null
  slow: boolean
  limit: number
  now: number
  flowRuns: Map<ID, StoryFlowRun>
  entries: Map<ID, Entry>
  onLoad: () => void
  onMore: () => void
  onUndo: (item: MemoryLogItem) => void
  onAnswer: (item: MemoryLogItem, optionId: string) => void
  onTryAgain: (item: MemoryLogItem) => void
  onOpenEntry: (id: ID) => void
  onShowWords: (item: MemoryLogItem) => void
  onOpenScene: (sceneId: ID) => void
  emptyHelp: string
  /** What the memory keeper isn't sure about (main's check queue, 0.6.40), over the ledger. */
  checks?: React.ReactNode
}

export function DeskLedger(p: DeskLedgerProps): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const [filter, setFilter] = useState<Filter>('all')
  const listRef = useRef<HTMLDivElement>(null)
  const items = p.items ?? []
  const counts: Record<Filter, number> = { all: 0, added: 0, updated: 0, removed: 0, asks: 0 }
  for (const i of items) {
    if (i.undone || i.action === 'failed') continue
    for (const f of FILTERS) if (f.id !== 'all' && keeps(f.id, i)) counts[f.id]++
    counts.all++
  }
  const groups = p.groups.map((g) => ({ ...g, items: g.items.filter((i) => keeps(filter, i)) })).filter((g) => g.items.length)
  useFlip(listRef, `${filter}:${groups.map((g) => g.items.map((i) => i.id).join()).join('|')}`)
  const title = p.sceneId ? (p.sceneTitle ? `What changed from “${p.sceneTitle}”` : 'What changed from this scene') : 'What changed'

  return (
    <div className="ck-desk lg-desk">
      <div className="ck-frame">
        <aside className="ck-side" aria-label="The memory">
          <button type="button" className="lg-back" onClick={() => navigate({ kind: 'write' })}>
            <ArrowLeft size={14} aria-hidden />
            {p.backLabel}
          </button>
          <LedgerArt className="ck-art" />
          <div className="ck-title-block">
            <p className="desk-caps">The memory</p>
            <h1 className="ck-title">{title}</h1>
            <p className="ck-story">
              {p.sceneId ? 'What the memory took from this scene, newest first.' : 'Everything the memory added or changed as you wrote, newest first. Undo any wrong guess.'}
            </p>
            {p.sceneId ? (
              <button type="button" className="lg-every" onClick={() => navigate({ kind: 'memory', sceneId: null })}>
                Show every scene
              </button>
            ) : null}
          </div>
          <KeeperCard />
          <div className="lg-tally" role="group" aria-label="Show changes">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="lg-tally-row" data-kind={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                <span className="lg-tally-mark" aria-hidden>
                  <ActionGlyph action={f.id} />
                </span>
                <span className="lg-tally-label">{f.label}</span>
                <TickNumber value={counts[f.id]} className="lg-tally-n" />
              </button>
            ))}
          </div>
        </aside>
        <div className="ck-main">
          <div className="lg-scroll" data-ck-scroll>
            {p.checks ? <div className="lg-pad lg-checks">{p.checks}</div> : null}
            {p.error && !p.items ? (
              <div className="lg-pad">
                <Notice
                  action={
                    <Button size="sm" onClick={p.onLoad}>
                      Try again
                    </Button>
                  }
                >
                  What changed can't be shown right now. {p.error}
                </Notice>
              </div>
            ) : !p.items ? (
              <div aria-busy className={cn('lg-pad flex flex-col gap-3 transition-opacity', p.slow ? 'opacity-100' : 'opacity-0')}>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-[96px] w-full rounded-xl" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-[96px] w-full rounded-xl" />
              </div>
            ) : !p.items.length ? (
              <div className="ck-calm" role="status">
                <LedgerArt className="lg-calm-art" />
                <h2 className="ck-calm-title">{p.sceneId ? 'Nothing taken from this scene yet' : 'Nothing has changed yet'}</h2>
                <p className="ck-calm-sub">{p.emptyHelp}</p>
              </div>
            ) : (
              <div className="lg-list" ref={listRef}>
                {!groups.length ? <p className="ck-none">Nothing here of that kind. Choose All to see the rest.</p> : null}
                {groups.map((g, gi) => (
                  <section key={g.key} aria-label={groupHeading(g)} className="lg-page" data-flip={g.key} style={{ '--i': gi } as React.CSSProperties}>
                    <header className="lg-page-head">
                      {g.sceneId && !p.sceneId ? (
                        <button type="button" className="lg-place" onClick={() => p.onOpenScene(g.sceneId!)} title="Open this scene">
                          {groupHeading(g)}
                          <ArrowUpRight size={12} aria-hidden />
                        </button>
                      ) : (
                        <span className="lg-place">{groupHeading(g)}</span>
                      )}
                      <span className="lg-when" title={fullDate(g.at)}>
                        {relativeTime(g.at, p.now)}
                      </span>
                    </header>
                    <ul className="lg-lines">
                      {g.items.map((item) => (
                        <LedgerLine key={item.id} item={item} {...p} />
                      ))}
                    </ul>
                  </section>
                ))}
                {items.length >= p.limit ? (
                  <div className="flex justify-center">
                    <Button size="sm" onClick={p.onMore}>
                      Show more
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const ACTION_WORDS = { added: 'Added', updated: 'Changed', removed: 'Removed', failed: 'Memory not updated' } as const

function ActionGlyph({ action }: { action: Filter | MemoryLogItem['action'] }): React.JSX.Element | null {
  if (action === 'added') return <Plus size={12} />
  if (action === 'updated') return <PenLine size={12} />
  if (action === 'removed') return <Minus size={12} />
  if (action === 'failed') return <CircleAlert size={13} />
  if (action === 'asks') return <span className="lg-q">?</span>
  return <span className="lg-all" />
}

/** How the memory is doing now: reading a scene (the lamp at work), up to date, or not updating and why. */
function KeeperCard(): React.JSX.Element {
  const status = useApp((s) => s.memoryStatus)
  const navigate = useApp((s) => s.navigate)
  const state = keeperState(status)
  const words: ReactNode =
    state === 'reading' && status?.reading ? (
      <>Reading “{status.reading.title.trim() || 'Untitled scene'}”{status.behind > 1 ? `, then ${status.behind - 1} more` : ''}…</>
    ) : state === 'error' ? (
      'Not updating right now.'
    ) : status && status.behind > 0 ? (
      `${status.behind === 1 ? 'One scene' : `${status.behind} scenes`} waiting to be read.`
    ) : (
      'Up to date with every scene.'
    )
  return (
    <div className="lg-keeper" data-state={state === 'idle' && status && status.behind > 0 ? 'waiting' : state} title={state === 'reading' && status ? readingNote(status) : undefined}>
      <span className="lg-keeper-dot" aria-hidden />
      <div className="min-w-0">
        <p className="lg-keeper-words" role="status">
          {words}
        </p>
        {state === 'error' && status?.error ? (
          <>
            <p className="lg-keeper-why">{status.error}</p>
            {pointsToSettings(status.error) ? (
              <button type="button" className="ck-link lg-keeper-go" onClick={() => navigate({ kind: 'settings', tab: 'models' })}>
                Open Settings › Models
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

function LedgerLine({
  item,
  flowRuns,
  entries,
  onUndo,
  onAnswer,
  onTryAgain,
  onOpenEntry,
  onShowWords
}: { item: MemoryLogItem } & DeskLedgerProps): React.JSX.Element {
  const look = useEntryLook()
  const place = flowRuns.get(item.runId)?.places[item.id] ?? null
  const changeGone = flowRuns.get(item.runId)?.gone.includes(item.id) ?? false
  const failed = item.action === 'failed'
  const { before, after } = beforeAfter(item)
  const gone = wordsGone(item)
  const name = item.entryName.trim()
  const canOpen = !!item.entryId && entries.has(item.entryId)
  const quote = item.quote.trim()
  const entryLook = item.entryId ? look(item.entryId) : { kind: null, motif: null }
  return (
    <li className="lg-line" data-action={item.action} data-undone={item.undone || undefined} data-flip={item.id}>
      <span className="lg-glyph" title={ACTION_WORDS[item.action]} aria-hidden>
        <ActionGlyph action={item.action} />
      </span>
      <div className="lg-body">
        <p className="lg-what">
          <span className="sr-only">{ACTION_WORDS[item.action]}: </span>
          {failed ? (
            <span className="lg-failed">{ACTION_WORDS.failed}</span>
          ) : name ? (
            <EntryMark
              {...entryLook}
              name={name}
              onClick={canOpen && !item.undone ? () => onOpenEntry(item.entryId!) : undefined}
              title={canOpen ? `Open ${name}` : undefined}
            />
          ) : null}
          <span className="lg-text">{item.text}</span>
        </p>
        {failed && pointsToSettings(item.text) ? (
          <button type="button" className="ck-link lg-small" onClick={() => useApp.getState().navigate({ kind: 'settings', tab: 'models' })}>
            Open Settings › Models
          </button>
        ) : null}
        {before || after ? (
          <p className="lg-change">
            {before ? (
              <span className="lg-before">
                <span className="sr-only">Before: </span>
                {before}
              </span>
            ) : null}
            {before && after ? <ArrowRight size={13} className="lg-arrow" aria-hidden /> : null}
            {after ? (
              <span className="lg-after">
                {before ? <span className="sr-only">Now: </span> : null}
                {after}
              </span>
            ) : null}
          </p>
        ) : null}
        {place ? <p className="lg-small lg-faint">{place}</p> : null}
        {quote ? (
          item.sceneId && !gone ? (
            <button type="button" className="lg-quote" onClick={() => onShowWords(item)} title="Show these words in the scene">
              <span>“{quote}”</span>
              <span className="lg-jump">
                In the scene <ArrowUpRight size={11} aria-hidden />
              </span>
            </button>
          ) : (
            <blockquote className="lg-quote is-gone" title={gone ? 'These words are no longer in the scene' : undefined}>
              {gone ? <span className="sr-only">No longer in the scene: </span> : null}“{quote}”
            </blockquote>
          )
        ) : null}
        {item.question && !item.undone && !changeGone ? (
          <div className="lg-ask">
            <span className="lg-ask-q">{item.question.text}</span>
            <span role="group" aria-label={item.question.text} className="lg-chips">
              {item.question.options.map((o) => {
                const on = item.question!.answer === o.id
                return (
                  <button key={o.id} type="button" aria-pressed={on} className="lg-chip" onClick={() => !on && onAnswer(item, o.id)}>
                    {o.label}
                  </button>
                )
              })}
            </span>
          </div>
        ) : null}
      </div>
      <div className="lg-act">
        {failed ? (
          <button type="button" className="ck-act" onClick={() => onTryAgain(item)} title="Read this scene again now">
            Try again
          </button>
        ) : item.undone ? (
          <span className="lg-undone">Undone</span>
        ) : canUndo(item) && !changeGone ? (
          <button
            type="button"
            className="ck-act"
            onClick={() => onUndo(item)}
            aria-label={`Undo: ${name ? `${name}, ` : ''}${item.text}`}
            title={place === null ? "Undo this. The memory won't add it again from the same words." : 'Undo this'}
          >
            Undo
          </button>
        ) : null}
      </div>
    </li>
  )
}
