// A scene as an index card on the desk's story board: faint ruled lines and a red margin rule, its title in the serif,
// what happens (its card's goal, else its first beat), and along the foot whose eyes it is told through, where it
// happens, when, and its words. "AI idea" in amber while a scene planned from an AI idea has no words. A click opens
// the scene; ⋯ opens its card in the drawer; it can be picked up and dragged (Alt+arrows from the keyboard). Each card
// tilts a little and straightens as the pointer comes to it.
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { BoardSceneCard } from '@shared/contracts/worldViews'
import type { ID, SceneMeta } from '@shared/types'
import { MoreHorizontal, Sparkles } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Portrait } from '@/features/views/Portrait'
import { openSceneTab } from '@/layout/areaLinks'
import type { PlacedCard } from './boardLayout'

export type PinKind = 'done' | 'drafted' | 'planned' | 'ai'

/** A scene's pin: done green, drafted (or revised) grey, planned hollow, planned from an AI idea amber. */
export function pinOf(scene: Pick<SceneMeta, 'status' | 'wordCount'>, ai: boolean): PinKind {
  if (ai && scene.wordCount === 0) return 'ai'
  if (scene.status === 'done') return 'done'
  if (scene.status === 'planned') return 'planned'
  return 'drafted'
}

export function Pin({ kind, style, inline }: { kind: PinKind; style?: CSSProperties; inline?: boolean }): React.JSX.Element {
  return (
    <span className={cn('board-pin', `is-${kind}`, inline && 'is-inline')} style={style} aria-hidden>
      <span className="board-pin-head" />
    </span>
  )
}

/** What happens in a scene, for its card: the card's goal, else its first beat. */
export const cardSummary = (card: BoardSceneCard | null): string => card?.goal.trim() || card?.beats.find((b) => b.trim())?.trim() || ''

export function BoardCard({
  box,
  scene,
  card,
  people,
  ai,
  current,
  fresh,
  lifted,
  delay,
  style,
  dragging,
  onPointerDown,
  onOpen,
  onKeyDown
}: {
  box: PlacedCard
  scene: SceneMeta
  card: BoardSceneCard | null
  people: Map<ID, CodexCard>
  /** Planned from an AI idea, and no words yet. */
  ai: boolean
  current: boolean
  fresh: boolean
  /** Its thread is picked out in the legend. */
  lifted: boolean
  delay: number
  style?: CSSProperties
  dragging: boolean
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onOpen: () => void
  onKeyDown: (e: KeyboardEvent) => void
}): React.JSX.Element {
  const pov = card?.povId ? people.get(card.povId) : undefined
  const place = card?.locationId ? people.get(card.locationId) : undefined
  const summary = cardSummary(card)
  const title = scene.title.trim() || 'Untitled scene'
  const words = scene.wordCount
  const label = [title, scene.status, words ? `${words.toLocaleString('en-GB')} words` : 'no words yet', pov ? `told through ${pov.name}` : '', ai ? 'planned from an AI idea' : '']
    .filter(Boolean)
    .join(', ')
  return (
    <div
      data-board-card={scene.id}
      className={cn('board-card', current && 'is-current', fresh && 'is-fresh', lifted && 'is-lifted', dragging && 'is-dragging', !summary && 'is-bare')}
      style={{ left: box.x, top: box.y, '--r': `${box.tilt}deg`, '--d': `${delay}ms`, ...style } as CSSProperties}
      onPointerDown={onPointerDown}
    >
      <span className="board-c-rules" aria-hidden />
      <span className="board-c-margin" aria-hidden />
      {/* The whole card opens the scene (and is what is picked up). */}
      <button type="button" className="board-c-open" aria-label={label} title="Open the scene (drag to move it; Alt+arrows from the keyboard)" onClick={onOpen} onKeyDown={onKeyDown} />
      {ai ? (
        <span className="board-c-ai">
          <Sparkles size={10} />
          AI idea
        </span>
      ) : null}
      <span className="board-c-title">{title}</span>
      <span className={cn('board-c-sum', !summary && 'is-empty')}>{summary || 'Nothing planned yet.'}</span>
      <span className="board-c-foot">
        {pov ? (
          <span className="board-c-mono" title={`Told through ${pov.name}`}>
            <Portrait entry={pov} size={20} />
          </span>
        ) : null}
        {place ? (
          <span className="board-c-mono" title={place.name}>
            <Portrait entry={place} size={20} />
          </span>
        ) : null}
        {card?.when.trim() ? <span className="board-c-when">{card.when.trim()}</span> : null}
        <span className="board-c-words tabular-nums">{words ? words.toLocaleString('en-GB') : '–'}</span>
      </span>
      <button
        type="button"
        className="board-c-more"
        aria-label={`Edit the card of ${title}`}
        title="Edit the scene’s card"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          useApp.getState().selectScene(scene.id)
          openSceneTab('card')
        }}
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  )
}
