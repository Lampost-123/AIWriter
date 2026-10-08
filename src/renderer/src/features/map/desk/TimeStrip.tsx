// The desk's relationship map: the timeline strip along its top. A stop for every scene on the story's line (and its
// start), grouped under their chapters' names, a mark over the stops where ties change, each scene's name on hover;
// click a stop or drag along the strip, or use the arrow keys (Home and End for the ends). The thumb glides to the
// stop (the view tier; quick from the keyboard).
import { useRef, useState } from 'react'
import type { AsOf, AsOfStop } from '@shared/types'
import type { MapStopInfo } from '@shared/contracts/worldViews'
import { ChevronLeft, ChevronRight } from '@/components/ui/icons'
import { inSentence } from '@/features/views/asOfLogic'
import { chapterSpans } from './deskMapLogic'

/** "Ch 1 · Sc 2" from "The Keeper’s Light, Ch 1, Sc 2". */
export const shortStop = (label: string): string => {
  const m = /Ch (\d+), Sc (\d+)$/.exec(label)
  return m ? `Ch ${m[1]} · Sc ${m[2]}` : label
}

export function TimeStrip({
  stops,
  info,
  index,
  onPick
}: {
  stops: AsOfStop[]
  info: MapStopInfo[]
  /** The stop shown (or being loaded). */
  index: number
  onPick: (at: AsOf, how: 'key' | 'pointer') => void
}): React.JSX.Element | null {
  const track = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  if (!stops.length) return null
  const n = stops.length
  const pos = (i: number): number => (n > 1 ? i / (n - 1) : 0.5)
  const current = stops[Math.max(0, Math.min(n - 1, index))]
  const here = info[index]
  const go = (i: number, how: 'key' | 'pointer'): void => {
    const j = Math.max(0, Math.min(n - 1, i))
    if (j !== index) onPick(stops[j].at, how)
  }
  const nearest = (clientX: number): number => {
    const r = track.current!.getBoundingClientRect()
    return Math.round(((clientX - r.left) / Math.max(1, r.width)) * (n - 1))
  }
  const spans = chapterSpans(stops, info)
  const many = n > 48
  const title = here?.title || (current.at.kind === 'start' ? 'Before the first scene' : current.at.kind === 'end' ? 'The end' : current.label)

  return (
    <div className="dm-float dm-strip" data-map-timeline>
      <div className="dm-asof">
        <div className="dm-asof-l">
          <span>As of</span>
          <span>{current.sceneId ? shortStop(current.label) : inSentence(current.label)}</span>
        </div>
        <div key={index} className="dm-asof-t" title={title}>
          {title}
        </div>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="As of"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={index}
        aria-valuetext={current.label}
        data-dragging={dragging || undefined}
        className="dm-track"
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
          if (step) go(index + step, 'key')
          else if (e.key === 'Home') go(0, 'key')
          else if (e.key === 'End') go(n - 1, 'key')
          else if (e.key === 'PageUp') go(index + 5, 'key')
          else if (e.key === 'PageDown') go(index - 5, 'key')
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          go(nearest(e.clientX), 'pointer')
        }}
        onPointerMove={(e) => dragging && go(nearest(e.clientX), 'pointer')}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <span className="dm-rail" />
        <span className="dm-fill" style={{ scale: `${pos(index)} 1` }} />
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            data-map-stop
            data-past={i <= index || undefined}
            data-changes={s.changes > 0 || undefined}
            data-many={many || undefined}
            aria-current={i === index ? 'step' : undefined}
            aria-label={`As of ${s.label}${info[i]?.title ? `: ${info[i].title}` : ''}`}
            className="dm-tick"
            style={{ left: `${pos(i) * 100}%` }}
            onPointerDown={(e) => {
              // A click on a stop goes straight there (the track's drag starts from it too).
              e.stopPropagation()
              track.current?.focus({ preventScroll: true })
              track.current?.setPointerCapture(e.pointerId)
              setDragging(true)
              go(i, 'pointer')
            }}
          >
            <i />
            <span className="dm-tip">
              <b>{s.sceneId ? shortStop(s.label) : inSentence(s.label)}</b>
              {info[i]?.title ? <span>{info[i].title}</span> : null}
              {s.changes > 0 ? <em>{s.changes === 1 ? '1 tie changes here' : `${s.changes} ties change here`}</em> : null}
            </span>
          </button>
        ))}
        {/* The thumb rides a rail as wide as the track, moved by a transform (the compositor's work, no repaint). */}
        <span className="dm-thumb-rail" style={{ translate: `${pos(index) * 100}% 0` }}>
          <span className="dm-thumb">
            <i />
          </span>
        </span>
        {spans.map((c) => {
          const from = pos(c.from)
          const to = pos(c.to)
          const pad = n > 1 ? 0.5 / (n - 1) : 0.5
          const left = Math.max(0, from - pad)
          const right = Math.min(1, to + pad)
          return (
            <span
              key={c.chapterId}
              className="dm-chapter"
              title={`Chapter ${c.n}${c.title ? `: ${c.title}` : ''}`}
              style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
            >
              <span>{c.title || `Chapter ${c.n}`}</span>
            </span>
          )
        })}
      </div>
      <div className="dm-strip-btns">
        <button type="button" className="dm-icon-btn" aria-label="Earlier scene" disabled={index <= 0} onClick={() => go(index - 1, 'pointer')}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="dm-icon-btn" aria-label="Later scene" disabled={index >= n - 1} onClick={() => go(index + 1, 'pointer')}>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
