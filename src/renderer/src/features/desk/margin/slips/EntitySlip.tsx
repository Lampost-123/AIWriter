// An entity's note in the desk's margin (UI overhaul, phase 3): a slip of paper in the entry's kind's ink beside the
// paragraph it is first named in, with its kind in small capitals (and "Since Ch 1" when the line below happened then,
// or "In memory" for lore), its name, its one-liner and the latest thing that happened to it before this scene. A click
// grows the slip into the entry's card (EntityCard); the × puts it away for this session.
import { useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { ArrowUpRight, X } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { KIND_LABELS } from '@shared/fields'
import { Portrait } from '@/features/views/Portrait'
import { displayName } from '@/features/peek/entryView'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import type { EntitySlipData } from '../anchors'
import { dismissSlip } from '../marginStore'
import { EntityCard } from './EntityCard'

/** How long the card takes to fold back into its slip. */
const CARD_OUT = 180

export function EntitySlip({ id, data, sceneId, inline }: { id: string; data: EntitySlipData; sceneId: ID; inline?: boolean }): React.JSX.Element {
  const { entry, tag, fact } = data
  const [card, setCard] = useState<'open' | 'closing' | null>(null)
  const slipRef = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const name = displayName(entry)

  const open = (): void => {
    clearTimeout(timer.current)
    setCard('open')
  }
  const close = (refocus: boolean): void => {
    const at = reducedMotion() || keyboardDriven() ? 0 : CARD_OUT
    setCard('closing')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCard(null), at)
    if (refocus) slipRef.current?.focus({ preventScroll: true })
  }

  return (
    <div className="desk-entity relative" data-card={card ?? undefined}>
      <button
        ref={slipRef}
        type="button"
        className={cn('desk-paper desk-entity-slip block w-full text-left', `k-${entry.kind}`)}
        aria-label={`${name}: open the card`}
        aria-expanded={card === 'open'}
        onClick={() => (card === 'open' ? close(false) : open())}
      >
        <span className="s-head">
          <span className="desk-caps s-kind">{KIND_LABELS[entry.kind]?.one ?? 'Entry'}</span>
          {tag ? <span className="s-tag">{tag}</span> : null}
        </span>
        <span className="s-name">
          <Portrait entry={entry} size={22} />
          <span className="min-w-0 truncate">{name}</span>
          <ArrowUpRight size={14} className="s-open" aria-hidden />
        </span>
        {entry.summary ? <span className="s-sub">{entry.summary}</span> : null}
        {fact ? <span className="s-fact">{fact.text}</span> : null}
      </button>
      <button type="button" className="desk-slip-x" aria-label={`Put ${name}’s note away`} title="Put this note away" onClick={() => dismissSlip(sceneId, id)}>
        <X size={12} />
      </button>
      {card ? <EntityCard data={data} closing={card === 'closing'} inline={inline} onClose={close} /> : null}
    </div>
  )
}
