// Cards dealt in (UI overhaul, "the AI planning pages"): each result card lands with a small rise and a straightening
// tilt as it first shows (planning.css, .plan-deal). Cards that show together land one after another; one that arrives
// on its own while the AI streams lands at once. The delay is settled when the card first shows and never changes.
import { useState } from 'react'
import { dealClock } from './planLogic'

const clock = dealClock()
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** This card's wait before it is dealt in, in ms (as a style: `--deal`). */
export function useDealDelay(): React.CSSProperties {
  const [delay] = useState(() => clock(now()))
  return { '--deal': `${delay}ms` } as React.CSSProperties
}
