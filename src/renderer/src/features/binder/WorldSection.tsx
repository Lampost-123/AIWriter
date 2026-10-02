import { MapPin, Palette, ScrollText, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { EntryKind } from '@shared/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'

type Counts = Partial<Record<EntryKind, number>>

const ENTRY_LINKS: { kind: EntryKind; label: string; icon: ReactNode }[] = [
  { kind: 'character', label: 'Characters', icon: <Users size={15} /> },
  { kind: 'place', label: 'Places', icon: <MapPin size={15} /> },
  { kind: 'lore', label: 'Lore', icon: <ScrollText size={15} /> }
]

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

function Link({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number | null; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
        active ? 'bg-accent-soft font-medium text-fg' : 'text-fg/90 hover:bg-surface-2'
      )}
    >
      <span className={cn('flex w-4 justify-center', active ? 'text-accent' : 'text-muted')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="min-w-[24px] text-right text-[11.5px] tabular-nums text-faint">{count ?? ''}</span>
    </button>
  )
}

/** The world's characters, places, lore and style guide, pinned to the bottom of the binder. */
export function WorldSection(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  const counts = useEntryCounts()

  return (
    <nav aria-label="World" className="shrink-0 border-t border-line px-1.5 pb-2 pt-2">
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">World</h3>
      {ENTRY_LINKS.map((l) => (
        <Link
          key={l.kind}
          icon={l.icon}
          label={l.label}
          count={counts ? (counts[l.kind] ?? 0) : null}
          active={view.kind === 'entries' && view.entryKind === l.kind}
          onClick={() => navigate({ kind: 'entries', entryKind: l.kind, entryId: null })}
        />
      ))}
      <Link icon={<Palette size={15} />} label="Style guide" active={view.kind === 'style'} onClick={() => navigate({ kind: 'style' })} />
    </nav>
  )
}
