// A kind's own page in the desk's World room (World › By kind): a banner over its cards with a fan of its most
// important entries' pictures, a title from the world's name ("The people of Gullhaven"), facts from its entries
// ("1 protagonist · 2 supporting"), and two figures. And the "New …" card at the end of the kind's cards: a blank one,
// or (for the kinds the builder makes) Build with AI and Quick start, in the AI's amber.
import './kind.css'
import type { CSSProperties } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { EntryKind } from '@shared/types'
import type { BuilderKind } from '@shared/contracts/builder'
import { Plus, Sparkles, WandSparkles } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { KIND_ICONS } from '@/features/world/kindIcons'
import { LandscapeArt, PortraitArt, Seal } from './CardArt'
import type { CardShape, KindBanner as Banner } from './galleryLogic'

/** The kinds the builder makes, with Build with AI and Quick start. */
const BUILDER: EntryKind[] = ['character', 'place', 'group', 'item']
const isBuilder = (k: EntryKind): k is BuilderKind => BUILDER.includes(k)

/** "A character", "Lore", "A term": what the New card makes. */
export const newWords = (k: EntryKind): string =>
  k === 'lore' ? 'New lore' : k === 'glossary' ? 'New term' : `New ${KIND_LABELS[k].one.toLowerCase()}`

function FanTile({ card, motif, k }: { card: CodexCard; motif: string | null; k: number }): React.JSX.Element {
  return (
    <span className="g-kfan-tile" data-k={k} data-kind={card.kind}>
      {card.kind === 'character' ? (
        <PortraitArt id={card.id} kind={card.kind} image={card.image} motif={motif} />
      ) : card.kind === 'place' ? (
        <LandscapeArt id={card.id} image={card.image} motif={motif} />
      ) : (
        <span className="g-kfan-seal">
          <Seal kind={card.kind} size={64} motif={motif} />
        </span>
      )}
    </span>
  )
}

export function KindBannerView({
  kind,
  banner,
  motifs,
  arriving
}: {
  kind: EntryKind
  banner: Banner
  motifs: Map<string, string>
  /** The fan opens as the page arrives (not from the keyboard, nor with less motion). */
  arriving: boolean
}): React.JSX.Element {
  const Icon = KIND_ICONS[kind]
  const words = KIND_LABELS[kind]
  return (
    <section className={cn('g-kband', arriving && 'is-arriving')} data-kind={kind} aria-label={`About the ${words.many.toLowerCase()}`}>
      <div className="g-kfan" aria-hidden>
        <span className="g-kfan-glow" />
        {banner.lead.length ? (
          [...banner.lead]
            .reverse()
            .map((c, i) => <FanTile key={c.id} card={c} motif={motifs.get(c.id) ?? null} k={banner.lead.length - 1 - i} />)
        ) : (
          <span className="g-kfan-tile g-kfan-empty" data-k={0}>
            <Icon size={34} />
          </span>
        )}
      </div>
      <div className="g-kband-text">
        <p className="g-kband-k">
          <Icon size={14} aria-hidden />
          {words.many} · {banner.facts[0]?.match(/^[\d,]+/)?.[0] ?? '0'}
        </p>
        <h2 className="g-kband-title">{banner.title}</h2>
        <p className={cn('g-kband-facts', banner.facts.length < 2 && 'is-empty')}>
          {banner.facts.slice(1).map((f, i) => (
            <span key={f} className="whitespace-nowrap">
              {i ? (
                <span aria-hidden className="g-kband-dot">
                  {' '}
                  ·{' '}
                </span>
              ) : null}
              {f}
            </span>
          ))}
        </p>
        {banner.most ? <p className="g-kband-most">{banner.most}</p> : null}
      </div>
      <dl className="g-kband-figs">
        <div>
          <dt>{banner.appearances === 1 ? 'appearance in a scene' : 'appearances in scenes'}</dt>
          <dd>{banner.appearances.toLocaleString('en-GB')}</dd>
        </div>
      </dl>
    </section>
  )
}

/** The New card at the end of a kind's cards, the size of the kind's own cards. */
export function NewKindCard({
  kind,
  shape,
  style,
  onBlank
}: {
  kind: EntryKind
  shape: CardShape
  style?: CSSProperties
  onBlank: () => void
}): React.JSX.Element {
  const builder = isBuilder(kind)
  const go = (mode: 'quick' | 'guided'): void => {
    if (isBuilder(kind)) useApp.getState().navigate({ kind: 'builder', entryKind: kind, entryId: null, start: { mode } })
  }
  return (
    <div className="g-knew g-in" data-shape={shape} data-kind={kind} style={style}>
      <button
        type="button"
        className="g-knew-main"
        onClick={onBlank}
        title={`A blank ${KIND_LABELS[kind].one.toLowerCase()}, opened to fill in`}
      >
        <span aria-hidden className="g-ghost-ic">
          <Plus size={18} />
        </span>
        <span className="g-ghost-t">{newWords(kind)}</span>
        <span className="g-ghost-d">{builder ? 'Blank, to fill in yourself' : 'Opened to fill in'}</span>
      </button>
      {builder ? (
        <span className="g-knew-ai">
          <button type="button" className="g-knew-btn" onClick={() => go('guided')}>
            <WandSparkles size={14} aria-hidden />
            Build with AI
          </button>
          <button type="button" className="g-knew-btn" onClick={() => go('quick')}>
            <Sparkles size={14} aria-hidden />
            Quick start
          </button>
        </span>
      ) : null}
    </div>
  )
}
