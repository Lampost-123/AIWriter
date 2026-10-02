// The inspector's "Drafts" tab: every draft of this scene, newest first, each
// with a link to exactly what the AI was given.
import { ChevronRight, History } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GenerationSummary, ID } from '@shared/types'
import { Badge, Button, EmptyState, Notice } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
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

  const slow = useDelayed(items === null && !error)

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

  if (!items) {
    return (
      <div className="flex flex-col gap-2 p-3" aria-busy>
        {slow ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[62px] w-full rounded-lg" />) : null}
      </div>
    )
  }

  if (!items.length) {
    return (
      <EmptyState icon={<History size={18} />} title="No drafts yet">
        Each time you press Generate, the draft is listed here with what it cost, and a link to see exactly what the AI was given.
      </EmptyState>
    )
  }

  return (
    <ul className="flex flex-col gap-1 p-2 animate-fade-in">
      {items.map((g) => {
        const streaming = g.status === 'streaming' && g.id === activeId
        const model = writer?.modelId === g.modelId && writer.label ? shortModelName(writer.label) : shortModelName(g.modelId)
        return (
          <li key={g.id}>
            <button
              type="button"
              // A draft still being written keeps writing while its record is open.
              onClick={() => navigate({ kind: 'generation', generationId: g.id })}
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
