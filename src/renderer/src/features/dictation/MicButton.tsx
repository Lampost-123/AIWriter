// A microphone button by a text box (Ask the world, the Quick start box; milestone 4): one click starts
// listening, the next stops and gives back what was said (tidied) for the box to put in at its cursor.
// It shows only when dictation can be used, and says what it is doing: the button turns to a stop
// button while listening, with "Listening" and the microphone's level beside it, then "Writing it down".
// It is small and sits in a line of text without making the line taller. Owned by the Dictation part.
import { Mic, Square } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useDictationReady } from './ready'
import { finishRecording, startRecording, useDictation } from './session'
import { areaOf, offerWords, rectOf } from './targets'

export interface MicButtonProps {
  /** What was said, tidied ("um" and stutters taken out), to put in the box at its cursor. */
  onText: (text: string) => void
  disabled?: boolean
  className?: string
}

/** A click is quick, so a little of the moment before it is kept too. */
const PRE_ROLL = 0.25

const CLOSED = 'The box your words were for has closed, so here they are to copy:'

export function MicButton({ onText, disabled, className }: MicButtonProps): React.JSX.Element | null {
  const ready = useDictationReady()
  const by = useId()
  const rec = useDictation((s) => s.recordings.find((r) => r.by === by) ?? null)
  const otherListening = useDictation((s) => s.recordings.some((r) => r.by !== by && r.phase !== 'writing'))
  const ref = useRef<HTMLButtonElement>(null)
  const latest = useRef(onText)
  latest.current = onText
  const mounted = useRef(true)

  const listening = !!rec && rec.phase !== 'writing'
  const id = rec?.id

  // Gone from the screen while listening: what was said is still written down, and offered to copy.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (id == null || !listening) return
    return () => {
      if (!mounted.current) finishRecording(id)
    }
  }, [id, listening])

  // The box stopped taking words (Quick start started building, say): stop listening, and hand over what was said.
  useEffect(() => {
    if (disabled && id != null && listening) finishRecording(id)
  }, [disabled, id, listening])

  // Shows only when dictation can be used (or while it is still busy with what it heard).
  if (ready !== true && !rec) return null

  const click = (): void => {
    if (rec) {
      if (listening) finishRecording(rec.id)
      return
    }
    const within = areaOf(() => ref.current)
    startRecording({
      owner: 'button',
      by,
      preRoll: PRE_ROLL,
      anchor: () => {
        const el = ref.current
        if (!el?.isConnected) return null
        const r = el.getBoundingClientRect()
        return r.width ? { kind: 'button', rect: rectOf(r), within: within() } : null
      },
      deliver: (text) => (mounted.current ? latest.current(text) : offerWords(text, CLOSED))
    })
  }

  const writing = rec?.phase === 'writing'
  const label = writing
    ? 'Writing down what you said'
    : listening
      ? 'Stop, and put in what you said'
      : otherListening
        ? 'Dictation is listening elsewhere'
        : 'Speak instead of typing: click, talk, then click again'

  return (
    <button
      ref={ref}
      type="button"
      onClick={click}
      disabled={(disabled && !rec) || (otherListening && !rec)}
      aria-disabled={writing || undefined}
      aria-pressed={listening}
      aria-label={label}
      title={label}
      data-dictation={rec?.phase ?? 'idle'}
      className={cn(
        '-my-[3px] inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40',
        listening
          ? 'bg-accent text-accent-fg hover:bg-accent-hover'
          : writing
            ? 'cursor-default text-muted'
            : 'text-muted hover:bg-surface-2 hover:text-fg',
        className
      )}
    >
      {writing ? (
        <Spinner size={13} />
      ) : listening ? (
        <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden />
      ) : (
        <Mic size={15} aria-hidden />
      )}
    </button>
  )
}
