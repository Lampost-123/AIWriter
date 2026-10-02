// The inspector's "Drafts" tab: the scene's drafts (the one in the page and the others kept beside it,
// milestone 4), then every draft the AI wrote for it, newest first, each with a link to exactly what the
// AI was given.
import { ChevronRight, History } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GenerationSummary, ID } from '@shared/types'
import type { SceneDrafts } from '@shared/contracts/history'
import { Badge, Button, EmptyState, Notice } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { DraftsSection, EarlierVersionsButton, NewDraftButton } from '@/features/history/DraftsSection'
import { formatCost, fullDate, relativeTime, shortModelName } from './format'
import { Skeleton, useDelayed, useNow } from './parts'

export function GenerationsPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const [items, setItems] = useState<GenerationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useApp((s) => s.navigate)
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const activeId = useApp((s) => (s.activeGeneration?.sceneId === sceneId ? s.activeGeneration.id : null))
  const now = useNow()
  const ticket = useRef(0)
  const [drafts, setDraftsState] = useState<SceneDrafts | null>(null)
  const draftTicket = useRef(0)

  // The scene's drafts. A change made here shows at once; anything older still on its way is dropped.
  const setDrafts = useCallback((d: SceneDrafts) => {
    ++draftTicket.current
    setDraftsState(d)
  }, [])
  const loadDrafts = useCallback(() => {
    const t = ++draftTicket.current
    api
      .listDrafts(sceneId)
      .then((d) => t === draftTicket.current && setDraftsState(d))
      .catch((e: Error) => t === draftTicket.current && setDraftsState({ available: false, problem: e.message, drafts: [] }))
  }, [sceneId])

  const load = useCallback(() => {
    const t = ++ticket.current
    api
      .listGenerations(sceneId)
      .then((list) => {
        if (t !== ticket.current) return
        setItems(list)
        setError(null)
      })
      .catch((e: Error) => {
        if (t !== ticket.current) return
        setError(e.message)
      })
  }, [sceneId])

  useEffect(() => {
    setItems(null)
    setError(null)
    load()
  }, [load])
  useEffect(() => {
    setDraftsState(null)
    loadDrafts()
    return onEvent('history:changed', (p) => p.sceneId === sceneId && loadDrafts())
  }, [sceneId, loadDrafts])

  // A new draft appears straight away; finished ones update when done.
  useEffect(() => {
    if (activeId) load()
  }, [activeId, load])
  useEffect(() => onEvent('generation:done', (p) => p.sceneId === sceneId && load()), [sceneId, load])
  // While a draft is being written, its word count catches up every moment or so.
  const liveListed = !!activeId && !!items?.some((g) => g.id === activeId && g.status === 'streaming')
  useEffect(() => {
    if (!liveListed) return
    const t = setInterval(load, 1500)
    return () => clearInterval(t)
  }, [liveListed, load])

  // Both lists come in together, so the tab doesn't fill in in two steps.
  const slow = useDelayed((items === null || drafts === null) && !error)

  if (error && !items) {
    return (
      <div className="p-3">
        <Notice
          tone="danger"
          action={
            <Button size="sm" variant="secondary" onClick={load}>
              Try again
            </Button>
          }
        >
          Couldn't load this scene's drafts. {error}
        </Notice>
      </div>
    )
  }

  if (!items || !drafts) {
    return (
      <div className="flex flex-col gap-2 p-3" aria-busy>
        {slow ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[62px] w-full rounded-lg" />) : null}
      </div>
    )
  }

  // Only the draft in the page, and nothing from the AI yet.
  if (!items.length && drafts.available && drafts.drafts.length <= 1) {
    return (
      <EmptyState
        icon={<History size={18} />}
        title="No drafts yet"
        actions={
          <>
            <NewDraftButton sceneId={sceneId} onChange={setDrafts} variant="secondary" />
            <EarlierVersionsButton sceneId={sceneId} />
          </>
        }
      >
        New draft keeps the text you have now as Draft 1 and starts a copy, to try the scene another way. Each time you press Generate, the
        AI's draft is listed here too, with what it cost and a link to see exactly what the AI was given.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-2 animate-fade-in">
      <DraftsSection sceneId={sceneId} drafts={drafts} onChange={setDrafts} reload={loadDrafts} />
      <section aria-label="Drafts the AI wrote">
        <h3 className="flex h-8 items-center pl-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Written by the AI</h3>
        {items.length ? (
          <AiDrafts
            items={items}
            activeId={activeId}
            writerId={writer?.modelId ?? null}
            writerLabel={writer?.label ?? null}
            now={now}
            onOpen={(id) => navigate({ kind: 'generation', generationId: id })}
          />
        ) : (
          <p className="px-1.5 text-[12px] leading-relaxed text-faint">
            Each time you press Generate, the draft is listed here with what it cost, and a link to see exactly what the AI was given.
          </p>
        )}
      </section>
      <div className="border-t border-line/70 pt-2">
        <EarlierVersionsButton sceneId={sceneId} />
      </div>
    </div>
  )
}

/** The drafts the AI wrote for the scene, newest first, each opening its record ("What the AI saw"). */
function AiDrafts({
  items,
  activeId,
  writerId,
  writerLabel,
  now,
  onOpen
}: {
  items: GenerationSummary[]
  activeId: ID | null
  writerId: string | null
  writerLabel: string | null
  now: number
  onOpen: (id: ID) => void
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((g) => {
        const streaming = g.status === 'streaming' && g.id === activeId
        const model = writerId === g.modelId && writerLabel ? shortModelName(writerLabel) : shortModelName(g.modelId)
        return (
          <li key={g.id}>
            <button
              type="button"
              // A draft still being written keeps writing while its record is open.
              onClick={() => onOpen(g.id)}
              title="See exactly what the AI was given for this draft"
              className="group flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2"
            >
              <div className="flex w-full items-center gap-2">
                <span className="min-w-0 truncate text-[13px] font-medium text-fg" title={g.modelId}>
                  {model}
                </span>
                <StatusBadge status={g.status} live={streaming} />
                {g.replaced ? (
                  <span className="shrink-0" title="This draft took the place of the scene's text. Its record keeps that text, to copy or put back.">
                    <Badge className="text-[11px]">Replaced</Badge>
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 whitespace-nowrap text-[11.5px] text-faint" title={fullDate(g.createdAt)}>
                  {relativeTime(g.createdAt, now)}
                </span>
              </div>
              <div className="flex w-full items-center gap-1.5 whitespace-nowrap text-[12px] text-muted">
                <span className="tabular-nums">
                  {g.words.toLocaleString()} {g.words === 1 ? 'word' : 'words'}
                </span>
                {g.cost != null ? (
                  <>
                    <span className="text-line-strong">·</span>
                    <span className="tabular-nums" title={g.costEstimated ? 'Estimated: the provider did not report the cost' : 'What the provider charged for this draft'}>
                      {g.costEstimated ? 'about ' : ''}
                      {formatCost(g.cost)}
                    </span>
                  </>
                ) : null}
                <span className="ml-auto flex shrink-0 items-center gap-0.5 font-medium text-accent opacity-80 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                  What the AI saw
                  <ChevronRight size={13} />
                </span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function StatusBadge({ status, live }: { status: GenerationSummary['status']; live: boolean }): React.JSX.Element | null {
  if (status === 'complete') return null
  const map = {
    streaming: { tone: 'ai' as const, label: live ? 'Writing' : 'Unfinished' },
    stopped: { tone: 'neutral' as const, label: 'Stopped' },
    error: { tone: 'danger' as const, label: 'Problem' }
  }
  const m = map[status]
  return (
    <Badge tone={m.tone} className="shrink-0 text-[11px]">
      {m.label}
    </Badge>
  )
}
