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
 * Flies the words of an idea from where it was offered (`from`, measured before the list closed) up into the field's
 * box, then glows the box. Waits two frames, so the field has its new words first; the copy flies at the field's own
 * width and padding, so its lines land exactly on the field's, and the field's words show again as it lands.
 */
export function flyInto(key: string, from: DOMRect, text: string): void {
  if (!mayFly()) return
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const box = fieldBox(key)
      if (!box) return
      const to = box.getBoundingClientRect()
      const look = getComputedStyle(box)
      const chip = document.createElement('div')
      chip.className = 'bld-fly'
      chip.setAttribute('aria-hidden', 'true')
      chip.textContent = text
      Object.assign(chip.style, {
        left: `${to.left}px`,
        top: `${to.top}px`,
        width: `${to.width}px`,
        minHeight: `${to.height}px`,
        padding: look.padding,
        font: look.font,
        lineHeight: look.lineHeight
      })
      document.body.appendChild(chip)
      // The field's own words wait under the copy until it lands.
      const was = box.style.color
      box.style.color = 'transparent'
      const dx = from.left - to.left
      const dy = from.top - to.top
      const land = (): void => {
        box.style.color = was
      }
      const run = chip.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.9 },
          { transform: 'translate(0, 0)', opacity: 1, offset: 0.82 },
          { transform: 'translate(0, 0)', opacity: 0 }
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      )
      const t = window.setTimeout(land, 320 * 0.82)
      run.onfinish = () => {
        chip.remove()
        land()
        glowField(key)
      }
      run.oncancel = () => {
        clearTimeout(t)
        chip.remove()
        land()
      }
    })
  )
}
