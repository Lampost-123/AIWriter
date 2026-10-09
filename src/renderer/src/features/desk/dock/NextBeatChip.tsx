// The next-beat chip over the AI dock (the desk, UI overhaul phase 3): the scene card's next beat still to write ("Next
// beat · The night ferry comes in early"). When its words land on the page the ring fills, the beat is struck through
// and the chip moves on to the next; once every beat is written it asks "Done for this scene: mark it done?" with Mark
// done; a scene marked done shows "Scene done · 1,240 words". Hidden when the card has no beats, and while Beat by beat
// has the foot of the page. Which beats are on the page comes from the scene's words (shared/beats.ts), no AI call.
import { useEffect, useRef, useState } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { beatStand, type BeatStand } from '@shared/beats'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useBeats } from '@/features/beats/session'
import { useOutline } from '@/features/binder/outlineStore'
import { markSceneDone } from '@/features/editor/markDone'
import { reducedMotion } from '@/features/look/motion'
import { useDeskCard, useSceneCard } from '../sceneCard'

/** How long a beat just written stays, struck through, before the chip moves on. */
const TICK_MS = 1400
/** The chip's own exit. */
const OUT_MS = 140

/** The beat ring: amber while it waits, filling green with a tick once its words are on the page. */
function Ring({ ticked, done }: { ticked: boolean; done?: boolean }): React.JSX.Element {
  return (
    <svg className={cn('desk-chip-ring', ticked && 'is-ticked', done && 'is-done')} width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <circle className="cr-track" cx={8} cy={8} r={6.25} />
      <circle className="cr-arc" cx={8} cy={8} r={6.25} transform="rotate(-90 8 8)" />
      <circle className="cr-fill" cx={8} cy={8} r={7} />
      <path className="cr-tick" d="M5.1 8.2l1.9 1.9 3.9-4" />
    </svg>
  )
}

type Shown = { stand: BeatStand; phase: 'in' | 'tick' | 'out' }

export function NextBeatChip({ sceneId, fallbackStatus }: { sceneId: ID; fallbackStatus: SceneStatus }): React.JSX.Element | null {
  const card = useSceneCard(sceneId)
  const beatsDone = useDeskCard((s) => s.beatsDone)
  const { outline } = useOutline()
  const status = outline?.scenes.find((s) => s.id === sceneId)?.status ?? fallbackStatus
  const words = useApp((s) => (s.sceneId === sceneId ? s.sceneWords : 0))
  const beatsOn = useBeats((s) => s.session?.sceneId === sceneId)
  const stand = card ? beatStand(card.beats, beatsDone, status === 'done') : ({ kind: 'none' } as BeatStand)

  // What shows lags behind a beat just written: it is ticked and struck through first, then the chip moves on.
  const [shown, setShown] = useState<Shown>({ stand, phase: 'in' })
  const shownRef = useRef(shown)
  shownRef.current = shown
  const key = JSON.stringify(stand)
  useEffect(() => {
    const was = shownRef.current
    if (JSON.stringify(was.stand) === key) return
    const moved = was.stand.kind === 'next' && (stand.kind === 'all' || (stand.kind === 'next' && stand.index > was.stand.index))
    if (!moved || reducedMotion()) {
      setShown({ stand, phase: 'in' })
      return
    }
    setShown({ stand: was.stand, phase: 'tick' })
    const t1 = setTimeout(() => setShown({ stand: was.stand, phase: 'out' }), TICK_MS)
    const t2 = setTimeout(() => setShown({ stand, phase: 'in' }), TICK_MS + OUT_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
    // Keyed on what it says, not on the object.
  }, [key, sceneId])

  // Another scene: no tick carried over from the last one, and what it says is this scene's (not the last one's, which
  // the effect above may have just been told to keep).
  const standRef = useRef(stand)
  standRef.current = stand
  useEffect(() => setShown({ stand: standRef.current, phase: 'in' }), [sceneId])

  const s = shown.stand
  if (beatsOn || s.kind === 'none') return null
  const phase = shown.phase === 'in' ? undefined : shown.phase
  return (
    <div
      key={`${s.kind}:${s.kind === 'next' ? s.index : ''}`}
      role="status"
      data-desk-chip={s.kind}
      data-focus-chrome
      className={cn('desk-chip pointer-events-auto', phase && `is-${phase}`, s.kind === 'all' && 'is-prompt')}
    >
      {s.kind === 'next' ? (
        <>
          <Ring ticked={shown.phase !== 'in'} />
          <span className="desk-chip-label">Next beat</span>
          <span className="desk-chip-text" title={s.beat}>
            {s.beat}
          </span>
        </>
      ) : s.kind === 'all' ? (
        <>
          <Ring ticked done />
          <span className="desk-chip-text">Done for this scene: mark it done?</span>
          <button type="button" className="desk-chip-btn" onClick={() => void markSceneDone(sceneId)}>
            Mark done
          </button>
        </>
      ) : (
        <>
          <Ring ticked done />
          <span className="desk-chip-text is-quiet">Scene done · {words.toLocaleString('en-GB')} words</span>
        </>
      )}
    </div>
  )
}
