// What the world builder made, on the desk (UI overhaul, "the AI planning pages"): each thing as the World room's
// gallery draws it, so it already looks like part of the world: a character as a portrait, a place as a landscape, and
// the other kinds on their own paper with their seal, each with its drawing from the drawing library (its own, or the
// one its words call for). Relationships are two names and the thread between them; themes and tone a slip of their
// own. Each card is dealt in as it is saved, with Open (the same as the list's: features/worldBuilder/WorldBuilderView).
import type { WorldBuildItem } from '@shared/contracts/worldBuilder'
import type { EntryKind } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { pickMotif } from '@shared/motifs'
import { Palette } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { LandscapeArt, PortraitArt, Seal } from '@/features/desk/world/CardArt'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { useDealDelay } from '@/features/planning/deal'
import { openItem, openLabel } from './WorldBuilderView'
import type { MadeSection } from './worldBuilderLogic'

const INK = (kind: EntryKind): React.CSSProperties => ({ '--kind-ink': `var(--k-${KIND_INK_KEY[kind]})`, '--kind-soft': `var(--k-${KIND_INK_KEY[kind]}-soft)` }) as React.CSSProperties
const KIND_INK_KEY: Record<EntryKind, string> = {
  character: 'char',
  place: 'place',
  group: 'group',
  item: 'item',
  lore: 'lore',
  event: 'event',
  thread: 'thread',
  glossary: 'gloss'
}

export function DeskSections({ sections }: { sections: MadeSection[] }): React.JSX.Element {
  const motifs = useEntryMotifs()
  return (
    <div className="plan-made-flow">
      {sections.map((sec) => (
        <section key={sec.key} aria-label={sec.label} className="plan-made">
          <h3 className="plan-made-h">
            {sec.label} <span>{sec.items.length}</span>
          </h3>
          <ul className="plan-wgrid">
            {sec.items.map((item) => (
              <li key={item.lineId} className="min-w-0">
                {item.what === 'relationship' ? (
                  <Relationship item={item} />
                ) : item.what === 'entry' && item.kind ? (
                  <EntryCard item={item} kind={item.kind} motif={(item.entryId && motifs.get(item.entryId)) || pickMotif({ kind: item.kind, name: item.name, summary: item.detail })} />
                ) : (
                  <StyleCard item={item} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function OpenButton({ item }: { item: WorldBuildItem }): React.JSX.Element {
  return item.undone ? (
    <span className="text-[12px] text-faint">Undone</span>
  ) : (
    <button type="button" className="plan-txt" onClick={() => openItem(item)} aria-label={openLabel(item)}>
      Open
    </button>
  )
}

function EntryCard({ item, kind, motif }: { item: WorldBuildItem; kind: EntryKind; motif: string }): React.JSX.Element {
  const deal = useDealDelay()
  const id = item.entryId ?? item.lineId
  return (
    <article className={cn('plan-wcard plan-deal', item.undone && 'is-undone')} style={{ ...deal, ...INK(kind) }} data-made={kind}>
      <div className={cn('plan-wcard-art', kind !== 'character' && kind !== 'place' && 'is-plain')}>
        {kind === 'character' ? (
          <PortraitArt id={id} kind={kind} image={null} motif={motif} />
        ) : kind === 'place' ? (
          <LandscapeArt id={id} image={null} motif={motif} />
        ) : (
          <Seal kind={kind} size={52} motif={motif} />
        )}
      </div>
      <div className="plan-wcard-body">
        <span className="plan-wcard-k">{KIND_LABELS[kind].one}</span>
        <span className={cn('plan-wcard-name', item.undone && 'text-faint')}>{item.name}</span>
        {item.detail ? (
          <p className="plan-wcard-d" title={item.detail}>
            {item.detail}
          </p>
        ) : null}
        <div className="plan-wcard-foot">
          {item.hardRule ? <span className="plan-rule-tag">Never to be broken</span> : null}
          <OpenButton item={item} />
        </div>
      </div>
    </article>
  )
}

function Relationship({ item }: { item: WorldBuildItem }): React.JSX.Element {
  const deal = useDealDelay()
  return (
    <div className={cn('plan-rel plan-deal', item.undone && 'opacity-55')} style={deal} data-made="relationship">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-serif text-[15px] font-semibold text-fg">{item.name}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted">
          <svg className="plan-rel-line" viewBox="0 0 34 14" fill="none" aria-hidden>
            <path d="M2 7 C 10 1, 24 13, 32 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="2.5" cy="7" r="2" fill="currentColor" />
            <circle cx="31.5" cy="7" r="2" fill="currentColor" />
          </svg>
          <span className="truncate">{item.detail}</span>
        </span>
      </span>
      <OpenButton item={item} />
    </div>
  )
}

function StyleCard({ item }: { item: WorldBuildItem }): React.JSX.Element {
  const deal = useDealDelay()
  return (
    <div className={cn('plan-rel plan-deal', item.undone && 'opacity-55')} style={deal} data-made={item.what}>
      <Palette size={18} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-[15px] font-semibold text-fg">{item.name}</span>
        {item.detail ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-[18px] text-muted">{item.detail}</span> : null}
      </span>
      <OpenButton item={item} />
    </div>
  )
}
