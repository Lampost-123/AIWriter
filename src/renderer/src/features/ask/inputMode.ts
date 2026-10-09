// Whether Adam is working from the keyboard (his last input was a key, not the pointer): the Ask panel's fades are
// skipped then, so what he moves to is there at once (the overhaul's motion rules; reduced motion is styles.css's).
import { reducedMotion } from '@/features/look/motion'

let keyboard = false
let listening = false

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', () => (keyboard = true), true)
  window.addEventListener('pointerdown', () => (keyboard = false), true)
  window.addEventListener('pointermove', () => (keyboard = false), { capture: true, passive: true })
}

/** True when something appearing now should appear at once rather than fade in. */
export function instantMotion(): boolean {
  listen()
  return keyboard || reducedMotion()
}
