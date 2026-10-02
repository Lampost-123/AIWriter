// "What changed": everything the memory keeper added, changed or removed, newest first and grouped
// by scene, so Adam can undo a wrong guess. He never has to look at it. Undoing needs no
// confirmation: an undone guess is simply greyed out, and the keeper won't make it again.
import { ArrowLeft, BookOpen, ChevronRight, Minus, PenLine, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Entry, ID, MemoryLogItem } from '@shared/types'
import { Button, EmptyState, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { fullDate, relativeTime } from '@/features/generate/format'
import { Skeleton, useDelayed, useNow } from '@/features/generate/parts'
import { groupHeading, groupLog, markUndone } from './logic'
import { openScene } from './openScene'

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
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [entries, setEntries] = useState<Map<ID, Entry>>(new Map())
  const [sceneTitle, setSceneTitle] = useState<string | null>(null)
  const [openTitle, setOpenTitle] = useState<string | null>(null)
  const ticket = useRef(0)
  const now = useNow()

  const load = useCallback(() => {
    const t = ++ticket.current
    api
      .listMemoryLog({ sceneId: sceneId ?? undefined, limit })
      .then((list) => {
        if (t !== ticket.current) return
        setItems(list)
        setError(null)
      })
      .catch((e: Error) => t === ticket.current && setError(e.message))
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

  const groups = useMemo(() => (items ? groupLog(items) : []), [items])
  const slow = useDelayed(!items && !error)

  const undo = async (item: MemoryLogItem): Promise<void> => {
    setItems((list) => (list ? markUndone(list, item.id) : list))
    try {
      await api.undoMemoryItem(item.id)
      toast("Undone. AI Write won't make that guess again for the same words.")
    } catch (e) {
      setItems((list) => (list ? list.map((i) => (i.id === item.id ? { ...i, undone: item.undone } : i)) : list))
      toast(`That couldn't be undone. ${(e as Error).message}`)
    }
  }

  const openEntry = (id: ID): void => {
    const entry = entries.get(id)
    if (entry) navigate({ kind: 'entries', entryKind: entry.kind, entryId: entry.id })
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
          {sceneId ? (sceneTitle ? `What changed in “${sceneTitle}”` : 'What changed in this scene') : 'What changed'}
        </h1>
        <div className="mt-1 flex min-h-[20px] flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span>
            {sceneId ? 'What the memory took from this scene, newest first.' : 'What the memory took from your scenes, newest first.'}
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
            <EmptyState icon={<BookOpen size={20} />} title={sceneId ? 'Nothing taken from this scene yet' : 'Nothing has changed yet'}>
              {WHAT_CHANGED_HELP}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-6 animate-fade-in">
              {groups.map((g) => (
                <section key={g.key} aria-label={groupHeading(g)}>
                  <h2 className="mb-2 flex items-center gap-1">
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
                  </h2>
                  <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                    {g.items.map((item) => (
                      <LogRow
                        key={item.id}
                        item={item}
                        now={now}
                        canOpen={!!item.entryId && entries.has(item.entryId)}
                        onOpen={() => item.entryId && openEntry(item.entryId)}
                        onUndo={() => void undo(item)}
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

const ACTION_ICONS = { added: Plus, updated: PenLine, removed: Minus } as const
const ACTION_WORDS = { added: 'Added', updated: 'Changed', removed: 'Removed' } as const

function LogRow({
  item,
  now,
  canOpen,
  onOpen,
  onUndo
}: {
  item: MemoryLogItem
  now: number
  canOpen: boolean
  onOpen: () => void
  onUndo: () => void
}): React.JSX.Element {
  const Icon = ACTION_ICONS[item.action] ?? PenLine
  // Undo turns into "Undone": keyboard focus moves onto it rather than being lost.
  const undoneRef = useRef<HTMLSpanElement>(null)
  const focusUndone = useRef(false)
  useEffect(() => {
    if (item.undone && focusUndone.current) {
      focusUndone.current = false
      undoneRef.current?.focus()
    }
  }, [item.undone])
  return (
    <li
      className={cn(
        'flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0 transition-opacity duration-200',
        item.undone && 'opacity-55'
      )}
    >
      <span
        className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"
        title={ACTION_WORDS[item.action]}
        aria-label={ACTION_WORDS[item.action]}
      >
        <Icon size={11} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {canOpen && !item.undone ? (
          <button
            type="button"
            onClick={onOpen}
            title="Open its page"
            className="rounded text-left text-[13.5px] leading-snug text-fg outline-none hover:text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {item.text}
          </button>
        ) : (
          <p className={cn('text-[13.5px] leading-snug text-fg', item.undone && 'line-through decoration-faint')}>{item.text}</p>
        )}
        {item.quote.trim() ? (
          <blockquote className="mt-1.5 select-text border-l-2 border-line pl-2.5 font-serif text-[13.5px] leading-relaxed text-muted">
            “{item.quote.trim()}”
          </blockquote>
        ) : null}
      </div>
      <div className="flex w-[132px] shrink-0 items-center justify-end gap-2">
        <span className="truncate text-[11.5px] text-faint" title={fullDate(item.createdAt)}>
          {relativeTime(item.createdAt, now)}
        </span>
        {item.undone ? (
          <span
            ref={undoneRef}
            tabIndex={-1}
            className="flex h-7 w-[52px] items-center justify-center rounded-md text-[12px] text-faint outline-none"
          >
            Undone
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-[52px] px-0"
            onClick={(e) => {
              focusUndone.current = e.currentTarget === document.activeElement
              onUndo()
            }}
            aria-label={`Undo: ${item.text}`}
            title="Undo this. The memory won't make the same guess again."
          >
            Undo
          </Button>
        )}
      </div>
    </li>
  )
}
