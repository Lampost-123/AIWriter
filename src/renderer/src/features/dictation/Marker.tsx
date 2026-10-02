// Dictation's marker: a small pill beside the place the words will go, "Listening" (with the microphone's
// level, so Adam can see it hears him) while recording and "Writing it down" while the speech engine works
// the words out. In the middle of a paragraph, where it would cover words, it shows small: just the level
// (or a spinner) in the gap above the cursor. It floats over the window, so nothing moves to make room for
// it, and it never takes a click. The microphone Test in Settings shows its own state instead.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { micLevel, onMicLevel } from './mic'
import { markerSpot } from './place'
import { useDictation, type Recording } from './session'

/** A 'starting' recording shows only if the microphone takes longer than this to open, so nothing flickers. */
const SLOW_START_MS = 250

/** The microphone's level now, from 0 to 1, while `on`. */
export function useMicLevel(on = true): number {
  const [level, setLevel] = useState(on ? micLevel : 0)
  useEffect(() => {
    if (!on) {
      setLevel(0)
      return
    }
    setLevel(micLevel())
    return onMicLevel(setLevel)
  }, [on])
  return level
}

/** Three small bars that rise and fall with the microphone's level. */
export function LevelBars({ className, small }: { className?: string; small?: boolean }): React.JSX.Element {
  const level = useMicLevel()
  return (
    <span className={cn('flex items-center gap-[2px]', small ? 'h-2.5' : 'h-3', className)} aria-hidden>
      {[0.65, 1, 0.8].map((k, i) => (
        <span
          key={i}
          className={cn('w-[3px] rounded-full bg-accent transition-transform duration-150 ease-out', small ? 'h-2.5' : 'h-3')}
          style={{ transform: `scaleY(${(0.25 + 0.75 * Math.min(1, level * k * 1.3)).toFixed(3)})` }}
        />
      ))}
    </span>
  )
}

/** The recording the marker is for: the one listening, else the latest being written down. */
function useShown(): Recording | null {
  return useDictation((s) => {
    let shown: Recording | null = null
    for (const r of s.recordings) {
      if (r.owner === 'test' || r.hidden) continue
      if (r.phase !== 'writing') return r
      shown = r
    }
    return shown
  })
}

export function DictationMarker(): React.JSX.Element | null {
  const rec = useShown()
  if (!rec) return null
  return createPortal(<Pill rec={rec} />, document.body)
}

function Pill({ rec }: { rec: Recording }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [slow, setSlow] = useState(false)
  /** Shown small: in the middle of a paragraph, where its words would cover the page's. */
  const [small, setSmall] = useState(false)
  const starting = rec.phase === 'starting'
  // The countdown is shown in words, wherever that puts it.
  const counting = rec.left != null

  useEffect(() => {
    if (!starting) return
    const t = setTimeout(() => setSlow(true), SLOW_START_MS)
    return () => clearTimeout(t)
  }, [starting])

  // Keeps beside its place on every frame while it shows: the page scrolls, the window is resized, the
  // pill gets wider as its words change. Moved by transform, so nothing else on the page moves. When it
  // turns small (or back), it waits, hidden, for that to be drawn before it is placed and shown again.
  const { anchor } = rec
  useLayoutEffect(() => {
    let frame = 0
    const place = (): void => {
      const el = ref.current
      if (el) {
        const spot = markerSpot(anchor?.() ?? null, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, !counting)
        if (spot.small !== small) {
          el.style.visibility = 'hidden'
          setSmall(spot.small)
          return
        }
        el.style.transform = `translate(${spot.x}px, ${spot.y}px)`
        el.style.visibility = 'visible'
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [anchor, starting, slow, small, counting])

  if (starting && !slow) return null
  const wordsOnly = rec.phase === 'writing' && rec.owner === 'button'
  const words = rec.phase === 'writing' ? 'Writing it down…' : starting ? 'Starting the microphone…' : 'Listening'
  return (
    <div
      ref={ref}
      role="status"
      data-dictation-marker={rec.phase}
      data-small={small || undefined}
      // Placed before it is first painted (see above), so it never shows in the corner first.
      style={{ visibility: 'hidden' }}
      className={cn(
        'pointer-events-none fixed left-0 top-0 z-[70] flex items-center whitespace-nowrap rounded-full border border-line bg-surface font-medium text-fg shadow-soft animate-fade-in',
        small ? 'h-4 px-1.5' : cn('h-6 gap-1.5 text-[11.5px]', wordsOnly ? 'px-2.5' : 'pl-2 pr-2.5')
      )}
    >
      {small ? (
        <>
          {rec.phase === 'listening' ? <LevelBars small /> : <Spinner size={10} className="text-muted" />}
          <span className="sr-only">{words}</span>
        </>
      ) : rec.phase === 'writing' ? (
        <>
          {/* A microphone button turns into a spinner itself, right beside it: one is enough. */}
          {wordsOnly ? null : <Spinner size={11} className="text-muted" />}
          {words}
        </>
      ) : starting ? (
        <>
          <Spinner size={11} className="text-muted" />
          {words}
        </>
      ) : (
        <>
          <LevelBars />
          {words}
          {rec.left != null ? <span className="font-normal tabular-nums text-muted">· {rec.left} s left</span> : null}
        </>
      )}
    </div>
  )
}
