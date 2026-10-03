// The start screen's opening (styles.css, "The start screen's opening"): the AI Write mark draws itself in the
// accent colour like ink while the cards rise softly into place, all within about a second, and a faint texture
// drifts behind the cards. CSS only. It never holds anything up: the cards can be clicked while it plays, and any
// key or click ends it at once. It pauses while the window is hidden, and with less motion it is a plain fade.
// It plays the first time the start screen shows in a run; coming back later, the screen simply fades in.

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** How long the opening runs before it is ended for certain (a little after the last card has risen). */
const OPENING_MS = 1100

let playedThisRun = false

export type OpeningPhase = 'playing' | 'done'

/** The opening's state: 'playing' the first time in a run, until it ends; and whether the window is hidden. */
export function useOpening(): { phase: OpeningPhase; paused: boolean } {
  const [phase, setPhase] = useState<OpeningPhase>(() => (playedThisRun ? 'done' : 'playing'))
  const [hidden, setHidden] = useState(() => document.hidden)

  useEffect(() => {
    playedThisRun = true
    const onVisibility = (): void => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (phase === 'done') return
    const finish = (): void => setPhase('done')
    // Any key or click ends it (the key or click still does what it does).
    document.addEventListener('keydown', finish, true)
    document.addEventListener('pointerdown', finish, true)
    // Its time only runs while the window shows (it is hidden until the first frame is painted).
    const timer = hidden ? undefined : setTimeout(finish, OPENING_MS)
    return () => {
      document.removeEventListener('keydown', finish, true)
      document.removeEventListener('pointerdown', finish, true)
      clearTimeout(timer)
    }
  }, [phase, hidden])

  return { phase, paused: hidden }
}

/** The AI Write mark (an open book with a spark above it), drawn in strokes of the accent colour. */
export function InkMark({ size = 44, className }: { size?: number; className?: string }): React.JSX.Element {
  // --at: when each stroke starts drawing; --ink: how long it takes (styles.css).
  const stroke = (d: string, at: number, ink = 260): React.JSX.Element => (
    <path d={d} pathLength={1} style={{ '--at': `${at}ms`, '--ink': `${ink}ms` } as React.CSSProperties} />
  )
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden
      className={cn('start-mark shrink-0 text-accent', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {stroke('M24 17 C19.5 14 13 13.4 7 14.4 L7 38.4 C13 37.4 19.5 38 24 41', 0, 520)}
      {stroke('M24 17 C28.5 14 35 13.4 41 14.4 L41 38.4 C35 37.4 28.5 38 24 41', 40, 520)}
      {stroke('M24 17 L24 41', 120, 360)}
      {stroke('M11 21 C14.2 20.5 17.2 20.9 20 21.9', 330)}
      {stroke('M28 21.9 C30.8 20.9 33.8 20.5 37 21', 380)}
      {stroke('M11 26 C14.2 25.5 17.2 25.9 20 26.9', 420)}
      {stroke('M28 26.9 C30.8 25.9 33.8 25.5 37 26', 470)}
      {stroke('M11 31 C13.5 30.6 15.5 30.8 17 31.3', 510)}
      {stroke('M31 31.3 C32.5 30.8 34.5 30.6 37 31', 550)}
      <path
        className="start-spark"
        d="M37 2.5 Q37.8 6.2 41.5 7 Q37.8 7.8 37 11.5 Q36.2 7.8 32.5 7 Q36.2 6.2 37 2.5 Z"
        pathLength={1}
        fill="currentColor"
        style={{ '--at': '600ms', '--ink': '280ms' } as React.CSSProperties}
      />
    </svg>
  )
}

/** The faint texture drifting behind the cards: soft patches of the accent colour, moved by the compositor only. */
export function DriftingTexture(): React.JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="start-texture absolute -inset-[15%]" />
    </div>
  )
}

/** The style that makes an element one of the cards rising in, `order` places in. */
export const rise = (order: number): React.CSSProperties => ({ '--rise': order }) as React.CSSProperties
