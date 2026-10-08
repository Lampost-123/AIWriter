// "What changed": every change the memory made as Adam wrote, newest first and grouped by the read
// that made it. Each line names the entry, shows the change as before and after, and links to the
// words it came from. Undo on any line reverses it (the memory won't add it again from those words);
// a question-marked line shows the choice the memory made and lets Adam pick another, any time.
// Adam never has to look at it, so nothing here asks to be confirmed. The story flows' runs (a time
// gap, a prequel's starting cast, "When did these happen?") belong to no scene: they get their own
// heading and say where each change is, such as "Start of Book 4"; a line whose change something else
// has taken out since says so, with nothing left to answer or undo.
import { ArrowLeft, BookOpen, ChevronRight, CircleAlert, Minus, PenLine, Plus } from '@/components/ui/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Entry, ID, MemoryCheckItem, MemoryLogItem } from '@shared/types'
import type { StoryFlowRun } from '@shared/contracts/storyFlows'
import { Button, EmptyState, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { requestReveal } from '@/features/editor/reveal'
import { fullDate, relativeTime } from '@/features/generate/format'
import { Skeleton, useDelayed, useNow } from '@/features/generate/parts'
import { beforeAfter, canUndo, groupHeading, groupLog, markAnswered, markUndone, pointsToSettings, wordsGone } from './logic'
import { openScene } from './openScene'
import { CheckQueue } from './CheckQueue'

const PAGE = 100

export const WHAT_CHANGED_HELP =
  'As you write, AI Write keeps the memory up to date by itself. Everything it adds or changes is listed here, so you can undo a wrong guess.'

export function WhatChanged({ sceneId }: { sceneId: ID | null }): React.JSX.Element {
  // A fresh page for each scene (or the whole world), never the last one's list.
  return <WhatChangedPage key={sceneId ?? 'all'} sceneId={sceneId} />
}

function WhatChangedPage({ sceneId }: { sceneId: ID | null }): React.JSX.Element {
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const openSceneId = useApp((s) => s.sceneId)
  const navigate = useApp((s) => s.navigate)
  const [items, setItems] = useState<MemoryLogItem[] | null>(null)
  // The memory check list (World Memory Overhaul B3), on the page for every scene: loaded with the list, so it never
  // pushes the list down after it shows.
  const [checks, setChecks] = useState<MemoryCheckItem[]>([])
  const [flowRuns, setFlowRuns] = useState<Map<ID, StoryFlowRun>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [entries, setEntries] = useState<Map<ID, Entry>>(new Map())
  const [sceneTitle, setSceneTitle] = useState<string | null>(null)
  const [openTitle, setOpenTitle] = useState<string | null>(null)
  const ticket = useRef(0)
  const now = useNow()

  const load = useCallback(() => {
    const t = ++ticket.current
    // The story flows' runs come with the list, so their headings never change after it shows.
    const runs: Promise<StoryFlowRun[]> = sceneId ? Promise.resolve([]) : api.listStoryFlowRuns().catch(() => [])
    const unsure: Promise<MemoryCheckItem[]> = sceneId ? Promise.resolve([]) : api.listMemoryChecks().catch(() => [])
    Promise.all([api.listMemoryLog({ sceneId: sceneId ?? undefined, limit }), runs, unsure])
      .then(([list, flows, found]) => {
        if (t !== ticket.current) return
        setItems(list)
        setFlowRuns(new Map(flows.map((r) => [r.runId, r])))
        setChecks(found)
        setError(null)
      })
      .catch((e: unknown) => t === ticket.current && setError(plainReason(e)))
  }, [sceneId, limit])

  // Reloads quietly when the memory changes (the list stays on screen meanwhile).
  useEffect(load, [load, memoryRev])

  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(new Map(list.map((e) => [e.id, e]))))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [entriesRev])

  // The scene this page is about, and the scene "Back" returns to.
  useEffect(() => {
    let live = true
    const title = (id: ID, set: (t: string | null) => void): void =>
      void api
        .getScene(id)
        .then((s) => live && set(s.title.trim() || 'Untitled scene'))
        .catch(() => live && set(null))
    if (sceneId) title(sceneId, setSceneTitle)
    if (openSceneId) title(openSceneId, setOpenTitle)
    return () => {
      live = false
    }
  }, [sceneId, openSceneId])

  const groups = useMemo(
    () => (items ? groupLog(items, new Map([...flowRuns.values()].map((r) => [r.runId, r.heading]))) : []),
    [items, flowRuns]
  )
  const slow = useDelayed(!items && !error)

  const undo = async (item: MemoryLogItem): Promise<void> => {
    setItems((list) => (list ? markUndone(list, item.id) : list))
    try {
      await api.undoMemoryItem(item.id)
      toast(item.note ? 'Dismissed.' : flowRuns.has(item.runId) ? 'Undone.' : "Undone. The memory won't add that again from the same words.")
    } catch (e) {
      setItems((list) => (list ? markUndone(list, item.id, false) : list))
      toast(`That couldn't be undone. ${plainReason(e)}`)
    }
  }

  const answer = async (item: MemoryLogItem, optionId: string): Promise<void> => {
    const before = item.question?.answer ?? null
    setItems((list) => (list ? markAnswered(list, item.id, optionId) : list))
    try {
      await api.answerMemoryQuestion(item.id, optionId)
    } catch (e) {
      setItems((list) => (list ? markAnswered(list, item.id, before) : list))
      toast(`That answer couldn't be saved. ${plainReason(e)}`)
    }
  }

  const tryAgain = async (item: MemoryLogItem): Promise<void> => {
    try {
      await api.updateMemoryNow(item.sceneId ?? undefined)
      toast('Trying again. The memory is reading the scene.')
    } catch (e) {
      toast(plainReason(e))
    }
  }

  const openEntry = (id: ID): void => {
    const entry = entries.get(id)
    if (entry) navigate({ kind: 'entries', entryKind: entry.kind, entryId: entry.id })
  }

  const showWords = (item: MemoryLogItem): void => {
    if (!item.sceneId) return
    requestReveal(item.sceneId, item.quote)
    void openScene(item.sceneId)
  }

  const backLabel = openSceneId && openTitle ? `Back to “${openTitle}”` : 'Back to writing'

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[760px] px-8 pb-16 pt-6">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft size={14} />}
          onClick={() => navigate({ kind: 'write' })}
          className="-ml-2.5 mb-3"
        >
          {backLabel}
        </Button>

        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">
          {sceneId ? (sceneTitle ? `What changed from “${sceneTitle}”` : 'What changed from this scene') : 'What changed'}
        </h1>
        <div className="mt-1 flex min-h-[20px] flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span>
            {sceneId ? 'What the memory took from this scene, newest first.' : 'Everything the memory added or changed, newest first.'}
          </span>
          {sceneId ? (
            <button
              type="button"
              className="rounded font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
              onClick={() => navigate({ kind: 'memory', sceneId: null })}
            >
              Show every scene
            </button>
          ) : null}
        </div>

        <div className="mt-6">
          {error && !items ? (
            <Notice
              action={
                <Button size="sm" onClick={load}>
                  Try again
                </Button>
              }
            >
              What changed can't be shown right now. {error}
            </Notice>
          ) : !items ? (
            <div aria-busy className={cn('flex flex-col gap-3 transition-opacity', slow ? 'opacity-100' : 'opacity-0')}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-[64px] w-full rounded-xl" />
              <Skeleton className="h-[64px] w-full rounded-xl" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-[64px] w-full rounded-xl" />
            </div>
          ) : !items.length ? (
            <>
              {checks.length ? (
                <div className="mb-8">
                  <CheckQueue items={checks} entries={entries} onChange={setChecks} onReload={load} />
                </div>
              ) : null}
              <EmptyState icon={<BookOpen size={20} />} title={sceneId ? 'Nothing taken from this scene yet' : 'Nothing has changed yet'}>
                {WHAT_CHANGED_HELP}
              </EmptyState>
            </>
          ) : (
            <div className="flex flex-col gap-6 animate-fade-in">
              <CheckQueue items={checks} entries={entries} onChange={setChecks} onReload={load} />
              {checks.length ? <h2 className="-mb-3 text-[15px] font-semibold text-fg">Every change</h2> : null}
              {groups.map((g) => (
                <section key={g.key} aria-label={groupHeading(g)}>
                  <h2 className="mb-2 flex items-baseline gap-2">
                    {g.sceneId && !sceneId ? (
                      <button
                        type="button"
                        onClick={() => void openScene(g.sceneId!)}
                        title="Open this scene"
                        className="group -ml-1 flex items-center gap-0.5 rounded px-1 text-[12px] font-semibold uppercase tracking-wide text-faint outline-none transition-colors duration-150 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        {groupHeading(g)}
                        <ChevronRight
                          size={13}
                          className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                          aria-hidden
                        />
                      </button>
                    ) : (
                      <span className="text-[12px] font-semibold uppercase tracking-wide text-faint">{groupHeading(g)}</span>
                    )}
                    <span className="text-[11.5px] text-faint" title={fullDate(g.at)}>
                      {relativeTime(g.at, now)}
                    </span>
                  </h2>
                  <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                    {g.items.map((item) => (
                      <LogRow
                        key={item.id}
                        item={item}
                        place={flowRuns.get(item.runId)?.places[item.id] ?? null}
                        gone={flowRuns.get(item.runId)?.gone.includes(item.id) ?? false}
                        canOpen={!!item.entryId && entries.has(item.entryId)}
                        onOpen={() => item.entryId && openEntry(item.entryId)}
                        onShowWords={() => showWords(item)}
                        onUndo={() => void undo(item)}
                        onAnswer={(optionId) => void answer(item, optionId)}
                        onTryAgain={() => void tryAgain(item)}
                        onOpenSettings={() => navigate({ kind: 'settings', tab: 'models' })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {items.length >= limit ? (
                <div className="flex justify-center">
                  <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
                    Show more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ACTION_ICONS = { added: Plus, updated: PenLine, removed: Minus, failed: CircleAlert } as const
const ACTION_WORDS = { added: 'Added', updated: 'Changed', removed: 'Removed', failed: 'Memory not updated' } as const

const linkClass = 'rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40'

function LogRow({
  item,
  place,
  gone: changeGone,
  canOpen,
  onOpen,
  onShowWords,
  onUndo,
  onAnswer,
  onTryAgain,
  onOpenSettings
}: {
  item: MemoryLogItem
  /** Where a story flow's change is now ("Start of Book 4"); null for the memory keeper's lines. */
  place: string | null
  /** A story flow's change taken out since by something else: no question or Undo. */
  gone: boolean
  canOpen: boolean
  onOpen: () => void
  onShowWords: () => void
  onUndo: () => void
  onAnswer: (optionId: string) => void
  onTryAgain: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const Icon = ACTION_ICONS[item.action] ?? PenLine
  const failed = item.action === 'failed'
  const { before, after } = beforeAfter(item)
  // Words deleted from the scene (or changed) are shown quietly, not as a way to words that aren't there.
  const gone = wordsGone(item)
  // Undo turns into "Undone": keyboard focus moves onto it rather than being lost.
  const undoneRef = useRef<HTMLSpanElement>(null)
  const focusUndone = useRef(false)
  useEffect(() => {
    if (item.undone && focusUndone.current) {
      focusUndone.current = false
      undoneRef.current?.focus()
    }
  }, [item.undone])
  const name = item.entryName.trim()

  return (
    <li className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
      <span
        className={cn(
          'mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
          failed ? 'text-ai' : 'bg-surface-2 text-muted',
          item.undone && 'opacity-55'
        )}
        title={ACTION_WORDS[item.action]}
      >
        <Icon size={failed ? 15 : 11} aria-hidden />
        {failed ? null : <span className="sr-only">{ACTION_WORDS[item.action]}: </span>}
      </span>

      <div className={cn('min-w-0 flex-1 transition-opacity duration-200', item.undone && 'opacity-55')}>
        <p className={cn('text-[13.5px] leading-snug text-fg', item.undone && 'line-through decoration-faint')}>
          {failed ? (
            <>
              <span className="font-semibold">{ACTION_WORDS.failed}</span>
              {item.text ? <span className="text-muted">: </span> : null}
            </>
          ) : null}
          {name && !failed ? (
            <>
              {canOpen && !item.undone ? (
                <button type="button" onClick={onOpen} title={`Open ${name}`} className={cn(linkClass, 'font-semibold hover:text-accent')}>
                  {name}
                </button>
              ) : (
                <span className="font-semibold">{name}</span>
              )}
              {item.text ? <span className="text-muted">: </span> : null}
            </>
          ) : null}
          {item.text}
        </p>
        {failed && pointsToSettings(item.text) ? (
          <button type="button" onClick={onOpenSettings} className={cn(linkClass, 'mt-1 text-[12.5px] font-medium text-accent')}>
            Open Settings › Models
          </button>
        ) : null}

        {before || after ? (
          <div className="mt-1 flex flex-col gap-0.5 text-[13px] leading-snug">
            {before ? (
              <p className="text-faint">
                <span className="sr-only">Before: </span>
                <span className="line-through decoration-faint/70">{before}</span>
              </p>
            ) : null}
            {after ? (
              <p className="text-fg">
                {before ? <span className="sr-only">Now: </span> : null}
                {after}
              </p>
            ) : null}
          </div>
        ) : null}
        {place ? <p className="mt-1 text-[12px] text-faint">{place}</p> : null}

        {item.quote.trim() ? (
          item.sceneId && !gone ? (
            <button
              type="button"
              onClick={onShowWords}
              title="Show these words in the scene"
              className="mt-1.5 block max-w-full rounded border-l-2 border-line pl-2.5 text-left font-serif text-[13.5px] leading-relaxed text-muted outline-none transition-colors duration-150 hover:border-accent/60 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              “{item.quote.trim()}”
            </button>
          ) : (
            <blockquote
              title={gone ? 'These words are no longer in the scene' : undefined}
              className={cn('mt-1.5 select-text border-l-2 border-line pl-2.5 font-serif text-[13.5px] leading-relaxed', gone ? 'text-faint' : 'text-muted')}
            >
              {gone ? <span className="sr-only">No longer in the scene: </span> : null}“{item.quote.trim()}”
            </blockquote>
          )
        ) : null}

        {item.question && !item.undone && !changeGone ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line-strong text-[11px] font-semibold text-muted"
              aria-hidden
            >
              ?
            </span>
            <span className="mr-1 text-[12.5px] text-muted">{item.question.text}</span>
            <span role="group" aria-label={item.question.text} className="flex flex-wrap gap-1">
              {item.question.options.map((o) => {
                const on = item.question!.answer === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => !on && onAnswer(o.id)}
                    className={cn(
                      'h-6 rounded-full border px-2.5 text-[12px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40',
                      on
                        ? 'border-accent/40 bg-accent-soft font-medium text-accent'
                        : 'border-line text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg'
                    )}
                  >
                    {o.label}
                  </button>
                )
              })}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex w-[76px] shrink-0 justify-end">
        {failed ? (
          <Button variant="ghost" size="sm" className="px-2" onClick={onTryAgain} title="Read this scene again now">
            Try again
          </Button>
        ) : item.undone ? (
          <span ref={undoneRef} tabIndex={-1} className="flex h-7 items-center rounded-md px-2 text-[12px] text-faint outline-none">
            {item.note ? 'Dismissed' : 'Undone'}
          </span>
        ) : canUndo(item) && !changeGone ? (
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            onClick={(e) => {
              focusUndone.current = e.currentTarget === document.activeElement
              onUndo()
            }}
            aria-label={`${item.note ? 'Dismiss' : 'Undo'}: ${name ? `${name}, ` : ''}${item.text}`}
            title={item.note ? 'Dismiss this note' : place === null ? "Undo this. The memory won't add it again from the same words." : 'Undo this'}
          >
            {item.note ? 'Dismiss' : 'Undo'}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
