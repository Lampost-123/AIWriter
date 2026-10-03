// Less motion when the system asks for it (milestone 6, "Look and feel"). styles.css stops every CSS transition
// and animation then; motion started from code (smooth scrolling, a glide written frame by frame) asks here.

/** True when the system asks for less motion (Windows: Settings › Accessibility › Visual effects › Animation effects off). */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** How to scroll something into place: smoothly, or in one step when the system asks for less motion. */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth')
