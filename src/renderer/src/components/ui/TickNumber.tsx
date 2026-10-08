// A count that ticks over like a counter's wheel when it changes (the desk's Check room, What changed): the old number
// slides out and the new one in, down when it falls and up when it rises, 220ms, by transform and opacity only. The
// number itself is plain text for a screen reader; with less motion it just changes.
import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import './tickNumber.css'

const LEAVE_MS = 260

export function TickNumber({ value, className }: { value: number; className?: string }): React.JSX.Element {
  const last = useRef(value)
  const [was, setWas] = useState<{ n: number; dir: 'down' | 'up' } | null>(null)
  useLayoutEffect(() => {
    if (last.current === value) return
    setWas({ n: last.current, dir: value < last.current ? 'down' : 'up' })
    last.current = value
    const t = setTimeout(() => setWas(null), LEAVE_MS)
    return () => clearTimeout(t)
  }, [value])
  return (
    <span className={cn('tick-num', className)} data-dir={was?.dir}>
      {was ? (
        <span key={`was-${was.n}`} className="tick-out" aria-hidden>
          {was.n.toLocaleString()}
        </span>
      ) : null}
      <span key={`now-${value}`} className={was ? 'tick-in' : undefined}>
        {value.toLocaleString()}
      </span>
    </span>
  )
}
