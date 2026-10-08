// The desk's one-time entrances (UI overhaul, D3.7): the first time a room shows in a session its pieces arrive (the
// sheet rises 8px in 320ms; the spine slides in 12px in 260ms after 60ms; the margin notes come in 6px, 60ms apart
// from 200ms; the AI dock rises 10px on the spring in 420ms after 300ms). Coming back to a room later, everything is
// simply there. Nothing arrives when the room was reached from the keyboard, or with less motion (desk.css's rules sit
// under [data-arrive], which is then never set).
import { useEffect, useState } from 'react'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'

/** Rooms (and pieces) that have arrived this session. */
const arrived = new Set<string>()

/** How long an arrival's marks stay on (the longest entrance, the dock's, ends by 720ms; the notes may come later). */
const ARRIVING_MS = 1600

/** True while `room` is arriving for the first time this session (then false, for good). */
export function useArrival(room: string): boolean {
  const [first] = useState(() => {
    const was = arrived.has(room)
    arrived.add(room)
    return !was && !keyboardDriven() && !reducedMotion()
  })
  const [on, setOn] = useState(first)
  useEffect(() => {
    if (!first) return
    const t = setTimeout(() => setOn(false), ARRIVING_MS)
    return () => clearTimeout(t)
  }, [first])
  return on
}

/** For tests: every room arrives again. */
export function resetArrivals(): void {
  arrived.clear()
}
