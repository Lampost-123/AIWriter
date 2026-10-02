import { CalendarRange, History, LayoutGrid, Network, Palette, Spool } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ENTRY_KINDS, KIND_LABELS } from '@shared/fields'
import type { EntryKind } from '@shared/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { KIND_ICONS } from '@/features/world/kindIcons'

type Counts = Partial<Record<EntryKind, number>>

// Every kind of entry, in a calm fixed order: characters, places, groups, items, lore, events, plot threads, glossary.
const ENTRY_LINKS: { kind: EntryKind; label: string; icon: ReactNode }[] = ENTRY_KINDS.map((kind) => {
  const Icon = KIND_ICONS[kind]
  return { kind, label: KIND_LABELS[kind].many, icon: <Icon size={14} /> }
})

/** Counts of world bible entries, reloaded whenever entries change. Null until first loaded. */
function useEntryCounts(): Counts | null {
  const rev = useApp((s) => s.entriesRev)
  const worldId = useApp((s) => s.world?.id)
  const [counts, setCounts] = useState<Counts | null>(null)
  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((entries) => {
        if (!live) return
        const c: Counts = {}
        for (const e of entries) c[e.kind] = (c[e.kind] ?? 0) + 1
        setCounts(c)
      })
      .catch(() => live && setCounts(null))
    return () => {
      live = false
    }
  }, [rev, worldId])
  return counts
}

function Link({
  active,
  icon,
  label,
  count,
  nested = false,
  onClick
}: {
  active: boolean
  icon: ReactNode
  label: string
  count?: number | null
  /** One of the codex's kinds, listed under it. */
  nested?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
        nested ? 'h-7 text-[12.5px]' : 'h-8 text-[13px]',
        active ? 'bg-accent-soft font-medium text-fg' : nested ? 'text-muted hover:bg-surface-2 hover:text-fg' : 'text-fg/90 hover:bg-surface-2'
      )}
    >
      <span className={cn('flex w-4 justify-center', active ? 'text-accent' : nested ? 'text-faint' : 'text-muted')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="min-w-[24px] text-right text-[11.5px] tabular-nums text-faint">{count ?? ''}</span>
    </button>
  )
}

/**
 * The world's pages, pinned to the bottom of the binder: the codex with each kind's list one click
 * away under it, then the timeline, relationship map, plot threads board, style guide and what changed.
 */
export function WorldSection(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  const counts = useEntryCounts()

  return (
    // In a short window the list scrolls rather than squeezing out the chapters above it.
    <nav aria-label="World" className="max-h-[50%] shrink-0 overflow-y-auto border-t border-line px-1.5 pb-2 pt-2">
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">World</h3>
      <Link icon={<LayoutGrid size={15} />} label="Codex" active={view.kind === 'codex'} onClick={() => navigate({ kind: 'codex' })} />
      {/* Each kind's list, under the codex: a quiet indented column joined to it by a thin line. */}
      <div className="mb-1 ml-[15px] border-l border-line pl-1">
        {ENTRY_LINKS.map((l) => (
          <Link
            key={l.kind}
            nested
            icon={l.icon}
            label={l.label}
            count={counts ? (counts[l.kind] ?? 0) : null}
            active={view.kind === 'entries' && view.entryKind === l.kind}
            onClick={() => navigate({ kind: 'entries', entryKind: l.kind, entryId: null })}
          />
        ))}
      </div>
      <Link icon={<CalendarRange size={15} />} label="Timeline" active={view.kind === 'timeline'} onClick={() => navigate({ kind: 'timeline' })} />
      <Link icon={<Network size={15} />} label="Relationship map" active={view.kind === 'map'} onClick={() => navigate({ kind: 'map' })} />
      <Link icon={<Spool size={15} />} label="Plot threads board" active={view.kind === 'threads'} onClick={() => navigate({ kind: 'threads' })} />
      <Link icon={<Palette size={15} />} label="Style guide" active={view.kind === 'style'} onClick={() => navigate({ kind: 'style' })} />
      <Link icon={<History size={15} />} label="What changed" active={view.kind === 'memory'} onClick={() => navigate({ kind: 'memory', sceneId: null })} />
    </nav>
  )
}
