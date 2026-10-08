// The scene card as a small ruled index card (UI overhaul, phase 3): where it happens, whose eyes it is told through and
// its beats as a checklist (written ✓, the next one marked Next), with Edit opening the full card form in the scene panel.
// An empty card offers to plan the scene instead: Ideas for this scene, or Interview me. The desk pins it in the margin
// beside the page's title; the panels' summary cards can show it too. It shows what it is given and loads nothing.
import { Lightbulb, MapPin, MessageCircleQuestion } from '@/components/ui/icons'
import type { ID } from '@shared/types'
import { cn } from '@/lib/cn'

export interface SceneCardSummaryProps {
  sceneId: ID
  /** The card has nothing on it yet. */
  empty: boolean
  place: string | null
  pov: string | null
  beats: string[]
  /** How many beats, from the first, are on the page. */
  beatsDone: number
  onEdit: () => void
  onIdeas: () => void
  onInterview: () => void
}

/** A beat's ring: hollow to come, amber for the next one, green with a tick once written. */
function BeatRing({ state }: { state: 'ok' | 'next' | 'todo' }): React.JSX.Element {
  return (
    <svg className={cn('ic-ring', `is-${state}`)} width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <circle className="ic-ring-track" cx={8} cy={8} r={6.25} />
      <circle className="ic-ring-fill" cx={8} cy={8} r={7} />
      <path className="ic-ring-tick" d="M5.1 8.2l1.9 1.9 3.9-4" />
    </svg>
  )
}

export function SceneCardSummary(p: SceneCardSummaryProps): React.JSX.Element {
  const initial = (p.pov ?? '').trim().charAt(0).toUpperCase()
  return (
    <div className="desk-icard" data-scene-card={p.sceneId}>
      <div className="ic-head">
        <span className="ic-m" aria-hidden />
        <span className="desk-caps">Scene card</span>
        <button type="button" className="ic-edit" onClick={p.onEdit} title="The whole card: goal, conflict, outcome, cast, length and notes">
          Edit
        </button>
      </div>
      {p.empty ? (
        <div className="ic-plan">
          <p className="ic-plan-title">Plan this scene</p>
          <p className="ic-plan-text">Nothing on its card yet. Ask for three directions, or answer a few questions.</p>
          <div className="ic-plan-acts">
            <button type="button" className="ic-act is-ai" onClick={p.onIdeas}>
              <Lightbulb size={14} aria-hidden />
              Ideas for this scene
            </button>
            <button type="button" className="ic-act" onClick={p.onInterview}>
              <MessageCircleQuestion size={14} aria-hidden />
              Interview me
            </button>
          </div>
        </div>
      ) : (
        <ul className="ic-rows">
          {p.place ? (
            <li className="ic-row">
              <span className="ic-m">
                <span className="ic-tile" aria-hidden>
                  <MapPin size={12} />
                </span>
              </span>
              <span className="ic-t ic-place" title={p.place}>
                {p.place}
              </span>
            </li>
          ) : null}
          {p.pov ? (
            <li className="ic-row">
              <span className="ic-m">
                <span className="ic-mono" aria-hidden>
                  {initial}
                </span>
              </span>
              <span className="ic-t">Told through {p.pov}</span>
            </li>
          ) : null}
          {p.beats.length ? (
            <>
              <li className="ic-row" aria-hidden>
                <span className="ic-m" />
                <span className="desk-caps ic-lab">Beats</span>
              </li>
              {p.beats.map((b, i) => {
                const state = i < p.beatsDone ? 'ok' : i === p.beatsDone ? 'next' : 'todo'
                return (
                  <li key={`${i}:${b}`} className={cn('ic-row', `is-${state}`)} aria-label={`${b}${state === 'ok' ? ', written' : state === 'next' ? ', next' : ''}`}>
                    <span className="ic-m">
                      <BeatRing state={state} />
                    </span>
                    <span className="ic-t">
                      <span className="truncate">{b}</span>
                      {state === 'next' ? <span className="ic-next">Next</span> : null}
                    </span>
                  </li>
                )
              })}
            </>
          ) : null}
        </ul>
      )}
    </div>
  )
}
