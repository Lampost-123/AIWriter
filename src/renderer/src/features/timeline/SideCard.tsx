// The side card on the New look's timeline (UI overhaul): what a scene (or event) picked on the river holds: when and
// where it happens, whose eyes it's told through, who's there, the threads it sets up and pays off, its goal and beats,
// and the way into it. Esc or × closes it.
import { useEffect, useRef, type CSSProperties } from 'react'
import type { ID } from '@shared/types'
import type { Timeline, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'
import { ArrowRight, CircleAlert, PenLine, X } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { Portrait } from '@/features/views/Portrait'
import { Sky } from './RiverParts'
import { skyOf, STATUS_WORDS, wordsLabel, type Told } from './riverLogic'

export function SideCard({
  timeline,
  point,
  told,
  toldNear,
  eyebrow,
  motifs,
  inks,
  onClose,
  onOpenPoint,
  onOpenEntry,
  onEditCard
}: {
  timeline: Timeline
  point: TimelinePoint
  told: Told
  toldNear: string
  eyebrow: string
  motifs: Map<ID, string>
  /** Each lane's ink, by entry id. */
  inks: Map<ID, string>
  onClose: () => void
  onOpenPoint: (p: TimelinePoint) => void
  onOpenEntry: (e: TimelineEntry) => void
  onEditCard: (p: TimelinePoint) => void
}): React.JSX.Element {
  const byId = new Map(timeline.entries.map((e) => [e.id, e]))
  const get = (ids: ID[]): TimelineEntry[] => ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []))
  const pov = point.povId ? byId.get(point.povId) : undefined
  const place = point.locationId ? byId.get(point.locationId) : undefined
  const present = get(point.presentIds.filter((id) => id !== point.povId))
  const setsUp = get(point.setsUpIds)
  const paysOff = get(point.paysOffIds)
  const heading = useRef<HTMLHeadingElement>(null)
  // A new pick: the card's heading is read out, without taking the keyboard from the river.
  useEffect(() => {
    heading.current?.scrollIntoView({ block: 'nearest' })
  }, [point.id])
  const scene = point.kind === 'scene'

  const person = (e: TimelineEntry, role?: string): React.JSX.Element => (
    <li key={e.id}>
      <button type="button" className="tl-sc-person" style={{ '--ink': inks.get(e.id) ?? 'var(--k-char)' } as CSSProperties} onClick={() => onOpenEntry(e)} title={`Open ${e.name}’s page`}>
        <Portrait entry={e} size={30} motif={motifs.get(e.id)} />
        <span className="min-w-0">
          <span className="tl-sc-pname">{e.name}</span>
          {role ? <span className="tl-sc-prole">{role}</span> : null}
        </span>
      </button>
    </li>
  )

  return (
    <aside className="tl-side" aria-label={scene ? 'About this scene' : 'About this event'} data-side-card={point.id}>
      <div className="tl-sc-scroll">
        <div className="tl-sc-head">
          <span className="tl-sc-eyebrow">{scene ? eyebrow : 'Event'}</span>
          <button type="button" className="tl-sc-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <h2 ref={heading} className="tl-sc-title">
          {point.title}
        </h2>
        <p className="tl-sc-when">
          <Sky sky={skyOf(point.key)} />
          <span>{point.when || 'No date yet'}</span>
          {point.when && !point.dated ? <span className="tl-sc-nodate">can’t be placed by date</span> : null}
        </p>
        {told ? (
          <p className={cn('tl-sc-told', `is-${told}`)}>
            {told === 'flashback' ? `A flashback: told after ${toldNear}, but it happens earlier.` : `Told early: it comes before ${toldNear} in the story, but happens later.`}
          </p>
        ) : null}
        {scene ? (
          <p className="tl-sc-status">
            <span className={cn('tl-pin', `is-${point.status === 'revised' ? 'drafted' : point.status}`)} aria-hidden />
            {STATUS_WORDS[point.status]} · {wordsLabel(point.words)}
          </p>
        ) : null}
        {point.clashes.map((c) => (
          <p key={c} className="tl-sc-clash">
            <CircleAlert size={14} aria-hidden />
            {timeline.clashes[c]?.text}
          </p>
        ))}

        {place ? (
          <section className="tl-sc-sec">
            <h3>Where</h3>
            <button type="button" className="tl-sc-place" onClick={() => onOpenEntry(place)} title={`Open ${place.name}’s page`}>
              <span className="tl-sc-placeart">
                <Portrait entry={place} size={44} motif={motifs.get(place.id)} />
              </span>
              <span className="tl-sc-pname">{place.name}</span>
            </button>
          </section>
        ) : null}
        {pov || present.length ? (
          <section className="tl-sc-sec">
            <h3>{scene ? 'Who’s there' : 'Who’s involved'}</h3>
            <ul className="tl-sc-people">
              {pov ? person(pov, 'Point of view') : null}
              {present.map((e) => person(e))}
            </ul>
          </section>
        ) : null}
        {setsUp.length || paysOff.length ? (
          <section className="tl-sc-sec">
            <h3>Plot threads</h3>
            <ul className="tl-sc-people">
              {setsUp.map((e) => person(e, 'Set up here'))}
              {paysOff.map((e) => person(e, 'Paid off here'))}
            </ul>
          </section>
        ) : null}
        {point.goal ? (
          <section className="tl-sc-sec">
            <h3>Goal</h3>
            <p className="tl-sc-goal">{point.goal}</p>
          </section>
        ) : null}
        {point.beats.length ? (
          <section className="tl-sc-sec">
            <h3>Beats</h3>
            <ol className="tl-sc-beats">
              {point.beats.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ol>
          </section>
        ) : null}
        {scene && !point.goal && !point.beats.length ? <p className="tl-sc-empty">Nothing planned on its card yet.</p> : null}
      </div>
      <div className="tl-sc-foot">
        <Button variant="primary" className="flex-1 justify-center" icon={<ArrowRight size={15} />} onClick={() => onOpenPoint(point)}>
          {scene ? 'Open scene' : 'Open event'}
        </Button>
        {scene ? (
          <Button icon={<PenLine size={15} />} onClick={() => onEditCard(point)} title="Edit the scene’s card">
            Card
          </Button>
        ) : null}
      </div>
    </aside>
  )
}
