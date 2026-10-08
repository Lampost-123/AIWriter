// The New look's timeline controls (UI overhaul): the lane picker (which characters or plot threads get a lane, each with
// its drawing and full name) and the filter (scenes with any picked character, plot thread or place stay lit).
import * as P from '@radix-ui/react-popover'
import { useMemo, useState, type CSSProperties } from 'react'
import type { ID } from '@shared/types'
import type { Timeline, TimelineEntry } from '@shared/contracts/worldViews'
import { Check, Rows3, Search, SlidersHorizontal } from '@/components/ui/icons'
import { Button, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { PopoverPanel } from '@/features/generate/parts'
import { Portrait } from '@/features/views/Portrait'
import { laneChoices, type LaneMode } from './timelineLogic'

function Row({
  entry,
  on,
  count,
  motif,
  ink,
  onToggle
}: {
  entry: TimelineEntry
  on: boolean
  count?: number
  motif: string | undefined
  ink?: string
  onToggle: (on: boolean) => void
}): React.JSX.Element {
  return (
    <label className={cn('tl-pick', on && 'is-on')} style={ink ? ({ '--ink': ink } as CSSProperties) : undefined}>
      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onToggle(e.target.checked)} />
      <span className="tl-pick-box" aria-hidden>
        {on ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <Portrait entry={entry} size={30} motif={motif} className="tl-pick-art" />
      <span className="tl-pick-name">{entry.name}</span>
      {count != null ? (
        <span className="tl-pick-count" title={`In ${count} ${count === 1 ? 'scene or event' : 'scenes and events'} on the timeline`}>
          {count}
        </span>
      ) : null}
    </label>
  )
}

/** Which lanes show: every character (or plot thread) on the timeline, busiest first, with its drawing. */
export function LanePicker({
  timeline,
  mode,
  shown,
  motifs,
  inks,
  onChoose
}: {
  timeline: Timeline
  mode: LaneMode
  shown: ID[]
  motifs: Map<ID, string>
  inks: Map<ID, string>
  onChoose: (ids: ID[] | null) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const choices = useMemo(() => laneChoices(timeline, mode), [timeline, mode])
  const on = new Set(shown)
  const q = query.trim().toLocaleLowerCase()
  const listed = q ? choices.filter((c) => c.entry.name.toLocaleLowerCase().includes(q)) : choices
  const noun = mode === 'characters' ? 'characters' : 'plot threads'
  const toggle = (id: ID, yes: boolean): void => {
    const next = new Set(on)
    if (yes) next.add(id)
    else next.delete(id)
    onChoose(choices.map((c) => c.entry.id).filter((x) => next.has(x)))
  }
  return (
    <P.Root onOpenChange={(open) => !open && setQuery('')}>
      <P.Trigger asChild>
        <Button icon={<Rows3 size={15} />} disabled={!choices.length}>
          Lanes {choices.length ? <span className="tabular-nums text-faint">{`${on.size} of ${choices.length}`}</span> : null}
        </Button>
      </P.Trigger>
      <PopoverPanel align="end" className="tl-pop w-[340px] p-0">
        <div className="tl-pop-head">
          <p className="tl-pop-title">A lane for each of these {noun}</p>
          <p className="tl-pop-sub">Busiest first. Each lane shows where they are along the river.</p>
          {choices.length > 8 ? (
            <div className="relative mt-2">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun}`} aria-label={`Search ${noun}`} className="pl-8" />
            </div>
          ) : null}
        </div>
        <div role="group" aria-label="Lanes" className="tl-pop-list">
          {listed.map(({ entry, count }) => (
            <Row key={entry.id} entry={entry} on={on.has(entry.id)} count={count} motif={motifs.get(entry.id)} ink={inks.get(entry.id)} onToggle={(v) => toggle(entry.id, v)} />
          ))}
          {!listed.length ? <p className="px-2 py-3 text-center text-[12.5px] text-muted">No {noun} match.</p> : null}
        </div>
        <div className="tl-pop-foot">
          <Button variant="ghost" size="sm" onClick={() => onChoose(null)}>
            Show the busiest
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChoose(choices.map((c) => c.entry.id))}>
            Show all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChoose([])}>
            Hide all
          </Button>
        </div>
      </PopoverPanel>
    </P.Root>
  )
}

/** The filter: characters, plot threads and places on the timeline; scenes with none of the picked ones step back. */
export function FilterPicker({
  timeline,
  picked,
  motifs,
  onChange
}: {
  timeline: Timeline
  picked: ReadonlySet<ID>
  motifs: Map<ID, string>
  onChange: (ids: Set<ID>) => void
}): React.JSX.Element {
  const groups = useMemo(() => {
    const used = (kind: 'character' | 'thread') => laneChoices(timeline, kind === 'character' ? 'characters' : 'threads').map((c) => c.entry)
    const places = timeline.entries.filter((e) => e.kind === 'place' && timeline.points.some((p) => p.locationId === e.id)).sort((a, b) => a.name.localeCompare(b.name))
    return [
      { label: 'Characters', list: used('character') },
      { label: 'Plot threads', list: used('thread') },
      { label: 'Places', list: places }
    ].filter((g) => g.list.length)
  }, [timeline])
  const toggle = (id: ID, on: boolean): void => {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    onChange(next)
  }
  return (
    <P.Root>
      <P.Trigger asChild>
        <Button icon={<SlidersHorizontal size={15} />} disabled={!groups.length} className={cn(picked.size && 'tl-filter-on')}>
          Filter {picked.size ? <span className="tl-filter-n tabular-nums">{picked.size}</span> : null}
        </Button>
      </P.Trigger>
      <PopoverPanel align="end" className="tl-pop w-[340px] p-0">
        <div className="tl-pop-head">
          <p className="tl-pop-title">Light up the scenes with…</p>
          <p className="tl-pop-sub">Scenes with none of these step back; the river keeps its shape.</p>
        </div>
        <div className="tl-pop-list" role="group" aria-label="Filter">
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <p className="tl-pop-group">{g.label}</p>
              {g.list.map((e) => (
                <Row key={e.id} entry={e} on={picked.has(e.id)} motif={motifs.get(e.id)} onToggle={(v) => toggle(e.id, v)} />
              ))}
            </div>
          ))}
        </div>
        <div className="tl-pop-foot">
          <Button variant="ghost" size="sm" disabled={!picked.size} onClick={() => onChange(new Set())}>
            Clear the filter
          </Button>
        </div>
      </PopoverPanel>
    </P.Root>
  )
}
