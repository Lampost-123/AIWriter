// The builder's one bit of AI motion: an idea Adam picks flies up into its field, and a suggestion he keeps settles
// into its box with a short amber glow (the lamp: amber is only ever the AI's). Web Animations, the quick tier (about
// 260ms), transform and opacity only, on a copy of the words laid over the page, so nothing in the page itself moves.
// From the keyboard, or with less motion, the words are simply there.
import { keyboardDriven, reducedMotion } from '@/features/look/motion'

/** Whether the AI's words may move into place now. */
export const mayFly = (): boolean => !reducedMotion() && !keyboardDriven()

/** The box of the field with this key (its text box), once it shows. */
const fieldBox = (key: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-bld-field="${CSS.escape(key)}"] [data-bld-box]`)

/** A short amber glow around a field's box: the AI's words have landed in it. */
export function glowField(key: string): void {
  if (!mayFly()) return
  const box = fieldBox(key)
  box?.animate(
    [
      { boxShadow: '0 0 0 0 color-mix(in srgb, var(--ai) 0%, transparent)' },
      { boxShadow: '0 0 0 4px color-mix(in srgb, var(--ai) 26%, transparent)', offset: 0.35 },
      { boxShadow: '0 0 0 0 color-mix(in srgb, var(--ai) 0%, transparent)' }
    ],
    { duration: 700, easing: 'ease-out' }
  )
}

/**
 * Flies the words of an idea from where it was offered (`from`, measured before the list closed) into the field's
 * box, then glows the box. Waits two frames, so the field shows its new words first.
 */
export function flyInto(key: string, from: DOMRect, text: string): void {
  if (!mayFly()) return
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const box = fieldBox(key)
      if (!box) return
      const to = box.getBoundingClientRect()
      const chip = document.createElement('div')
      chip.className = 'bld-fly'
      chip.setAttribute('aria-hidden', 'true')
      chip.textContent = text
      Object.assign(chip.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
      document.body.appendChild(chip)
      const dx = to.left - from.left
      const dy = to.top - from.top
      const sx = Math.max(0.2, to.width / Math.max(1, from.width))
      const sy = Math.max(0.2, to.height / Math.max(1, from.height))
      const run = chip.animate(
        [
          { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.85, offset: 0.8 },
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0 }
        ],
        { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      )
      const done = (): void => chip.remove()
      run.onfinish = () => {
        done()
        glowField(key)
      }
      run.oncancel = done
    })
  )
}
