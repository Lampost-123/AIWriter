// The slim bar above the page while reading: who is speaking and how ("Mara · quiet and wary"), Pause,
// Stop and Close. Rendered by SceneView between the scene header and the page. Owned by the Read aloud
// part.
//
// It lies over the top edge of the page rather than pushing the page down, so the words never move when it
// comes and goes; it fades in and out. While it shows, the page keeps the cursor and the sentence being read clear
// of it (highlight.ts, follow.ts). It also hands the page to the reading (control.ts) and listens for
// Ctrl+Shift+Space, which stops reading from anywhere.
import type { Editor } from '@tiptap/core'
import { Pause, Play, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { Button, IconButton, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isShortcut, withShortcut } from '@/lib/shortcuts'
import {
  attachPage,
  closeReading,
  listenAgain,
  openSpeechSettings,
  pauseReading,
  resumeReading,
  sceneShown,
  skipLine,
  stopReading,
  useReading,
  type ReadingBar
} from './control'
import { setBarRoom } from './highlight'
import { stopSample } from './useSample'
import './readAloud.css'

export function ReadAloudBar({
  editor,
  sceneId,
  scrollerRef
}: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const bar = useReading((s) => s.bar)

  useEffect(() => attachPage(editor, () => scrollerRef.current), [editor, scrollerRef])
  useEffect(() => sceneShown(sceneId), [sceneId])

  // Ctrl+Shift+Space stops reading (and any sample) from anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isShortcut(e, 'stopReading')) return
      const { reading, bar: shown } = useReading.getState()
      if (!reading && shown?.phase !== 'starting') {
        stopSample()
        return
      }
      e.preventDefault()
      stopReading()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The bar fades out with what it last said, rather than vanishing.
  const [shown, setShown] = useState<ReadingBar | null>(bar)
  const [leaving, setLeaving] = useState(false)
  const last = useRef(bar)
  useEffect(() => {
    if (bar) {
      last.current = bar
      setShown(bar)
      setLeaving(false)
      return
    }
    if (!last.current) return
    setLeaving(true)
    const t = setTimeout(() => {
      last.current = null
      setShown(null)
      setLeaving(false)
    }, 160)
    return () => clearTimeout(t)
  }, [bar])

  // While it shows, the room it takes over the top of the page: the cursor is scrolled clear of it, and so is
  // anything brought into view (the page's own scroll padding).
  const box = useRef<HTMLDivElement>(null)
  const open = !!shown
  useLayoutEffect(() => {
    const el = box.current
    const page = scrollerRef.current
    if (!open || !el) return
    const room = (): void => {
      setBarRoom(el.offsetHeight)
      if (page) page.style.scrollPaddingTop = `${el.offsetHeight}px`
    }
    room()
    const ro = new ResizeObserver(room)
    ro.observe(el)
    return () => {
      ro.disconnect()
      setBarRoom(0)
      if (page) page.style.scrollPaddingTop = ''
    }
  }, [open, scrollerRef])

  if (!shown) return null
  return (
    <div className="relative z-20 h-0 shrink-0">
      <div
        ref={box}
        role="region"
        aria-label="Reading aloud"
        className={cn(
          'absolute inset-x-0 top-0 flex min-h-9 items-center gap-2 border-b border-line/70 bg-page pl-4 pr-2 font-sans',
          'transition-opacity duration-150',
          leaving ? 'pointer-events-none opacity-0' : 'animate-fade-in'
        )}
      >
        <Indicator phase={shown.phase} />
        <Words bar={shown} />
        <Actions bar={shown} />
      </div>
    </div>
  )
}

/** Moving bars while a voice speaks; still when paused; a spinner while lines are got ready. */
function Indicator({ phase }: { phase: ReadingBar['phase'] }): React.JSX.Element | null {
  if (phase === 'starting' || phase === 'waiting') return <Spinner size={13} className="shrink-0 text-faint" />
  if (phase !== 'playing' && phase !== 'paused') return null
  return (
    <span className="aw-speaking flex h-3.5 w-3.5 shrink-0 items-end justify-center gap-[2px]" data-live={phase === 'playing'} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="block h-full w-[3px] rounded-full bg-accent" />
      ))}
    </span>
  )
}

function Words({ bar }: { bar: ReadingBar }): React.JSX.Element {
  const speaking = (bar.phase === 'playing' || bar.phase === 'paused') && !!bar.who
  return (
    <p
      // What went wrong may take two lines (the bar grows over the page, so nothing moves); the rest is one line. The
      // room around two lines is margin, not padding, so no part of a third line shows in it.
      className={cn('min-w-0 flex-1 text-[12.5px]', bar.phase === 'problem' ? 'my-2 line-clamp-2 leading-snug' : 'truncate leading-none')}
      aria-live={bar.phase === 'problem' || bar.phase === 'stopped' || bar.phase === 'finished' ? 'polite' : undefined}
      title={speaking ? [bar.who, bar.how].filter(Boolean).join(' · ') : bar.note}
    >
      {speaking ? (
        <>
          <span className="font-medium text-fg">{bar.who}</span>
          {bar.how ? <span className="text-muted"> · {bar.how}</span> : null}
          {bar.phase === 'paused' ? <span className="text-faint"> · Paused</span> : null}
        </>
      ) : bar.phase === 'paused' ? (
        <span className="text-muted">Paused</span>
      ) : (
        <span className={bar.phase === 'problem' ? 'text-fg' : 'text-muted'}>{bar.note}</span>
      )}
    </p>
  )
}

function Actions({ bar }: { bar: ReadingBar }): React.JSX.Element {
  const live = bar.phase === 'starting' || bar.phase === 'waiting' || bar.phase === 'playing' || bar.phase === 'paused'
  const paused = bar.phase === 'paused'
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {bar.phase === 'problem' && bar.fix === 'settings' ? (
        <Button size="sm" variant="secondary" className="mr-1 h-6" onClick={openSpeechSettings}>
          Open speech settings
        </Button>
      ) : null}
      {bar.phase === 'problem' && bar.fix ? (
        <Button size="sm" variant={bar.fix === 'retry' ? 'secondary' : 'ghost'} className="mr-1 h-6" onClick={listenAgain}>
          Try again
        </Button>
      ) : null}
      {bar.phase === 'problem' && bar.skip ? (
        <Button size="sm" variant="ghost" className="mr-1 h-6" onClick={skipLine}>
          Skip this line
        </Button>
      ) : null}
      {bar.phase === 'stopped' ? (
        <Button size="sm" variant="ghost" className="mr-0.5 h-6 px-2" icon={<Play size={13} />} onClick={listenAgain}>
          Carry on
        </Button>
      ) : null}
      {live ? (
        <>
          <IconButton
            size="sm"
            label={paused ? withShortcut('Carry on', 'listen') : withShortcut('Pause', 'listen')}
            onClick={() => (paused ? resumeReading() : pauseReading())}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </IconButton>
          <IconButton size="sm" label={withShortcut('Stop reading', 'stopReading')} onClick={stopReading}>
            <Square size={11} />
          </IconButton>
        </>
      ) : null}
      <IconButton size="sm" label="Close" onClick={closeReading}>
        <X size={14} />
      </IconButton>
    </div>
  )
}
