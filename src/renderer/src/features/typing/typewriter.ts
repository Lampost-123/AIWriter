// Typewriter scrolling (writing by hand; Settings › Editor, off until Adam turns it on): while he types, the
// line he is typing on stays at the same height on screen, about 40% of the way down the page, and the
// page moves instead. Only his own typing moves it (keys pressed in the page), never a click, a draft being
// written in (the page follows that itself), reading aloud (it follows the words being read), or focus
// mode's panels sliding (it holds the line then). It glides there in 160 ms, or jumps when the system asks
// for less motion.
import type { Editor } from '@tiptap/core'
import { useApp } from '@/lib/store'
import { activeStream } from '@/features/editor/streamDoc'
import { useFocusMode } from '@/features/look/focusMode'
import { reducedMotion } from '@/features/look/motion'
import { useReading } from '@/features/readAloud/control'

/** How far down the page the line being typed stays. */
export const TYPEWRITER_AT = 0.4
const GLIDE_MS = 160
/** A change this soon after a key pressed in the page is Adam typing. */
const TYPED_WITHIN_MS = 250

export const typewriterOn = (): boolean => !!useApp.getState().settings?.editor?.typewriter

/**
 * Where to scroll the page to so the caret's line sits `at` of the way down it, or null when it is already
 * there (within 2 px) or can't move. `caretTop` and `boxTop` are on screen; the rest are the scroller's own.
 */
export function typewriterTarget(p: {
  caretTop: number
  boxTop: number
  clientHeight: number
  scrollTop: number
  scrollHeight: number
  at?: number
}): number | null {
  const want = p.boxTop + p.clientHeight * (p.at ?? TYPEWRITER_AT)
  const max = Math.max(0, p.scrollHeight - p.clientHeight)
  const target = Math.round(Math.max(0, Math.min(max, p.scrollTop + (p.caretTop - want))))
  return Math.abs(target - p.scrollTop) < 2 ? null : target
}

/** Keeps the line being typed at the same height while typewriter scrolling is on. Returns the way to stop. */
export function attachTypewriter(editor: Editor, scroller: () => HTMLElement | null): () => void {
  const dom = editor.view.dom as HTMLElement
  let keyedAt = 0
  let raf = 0
  let pending = 0

  const cancel = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const glide = (el: HTMLElement, target: number): void => {
    cancel()
    if (reducedMotion()) {
      el.scrollTop = target
      return
    }
    const from = el.scrollTop
    const start = performance.now()
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / GLIDE_MS)
      // Ease out: quick to start, gentle to settle.
      el.scrollTop = from + (target - from) * (1 - (1 - t) ** 3)
      raf = t < 1 ? requestAnimationFrame(tick) : 0
    }
    raf = requestAnimationFrame(tick)
  }

  const align = (): void => {
    pending = 0
    const el = scroller()
    if (!el || editor.isDestroyed || !typewriterOn()) return
    const reading = useReading.getState()
    if ((reading.reading && !reading.paused) || useFocusMode.getState().moving || activeStream(editor.state)) return
    const sel = editor.state.selection
    if (!sel.empty || !editor.view.hasFocus()) return
    let caretTop: number
    try {
      caretTop = editor.view.coordsAtPos(sel.head).top
    } catch {
      return
    }
    const target = typewriterTarget({
      caretTop,
      boxTop: el.getBoundingClientRect().top,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight
    })
    if (target !== null) glide(el, target)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
    keyedAt = performance.now()
  }
  const onInput = (): void => {
    keyedAt = performance.now()
  }
  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
    if (!transaction.docChanged || performance.now() - keyedAt > TYPED_WITHIN_MS || !typewriterOn()) return
    // Once the page has drawn the change (and the editor has kept the caret in view).
    if (!pending) pending = requestAnimationFrame(align)
  }
  // Adam scrolling himself (the wheel) stops a glide under way.
  const onWheel = (): void => cancel()

  dom.addEventListener('keydown', onKey)
  dom.addEventListener('input', onInput)
  dom.addEventListener('paste', onInput)
  editor.on('transaction', onTransaction)
  const el = scroller()
  el?.addEventListener('wheel', onWheel, { passive: true })
  return () => {
    cancel()
    if (pending) cancelAnimationFrame(pending)
    dom.removeEventListener('keydown', onKey)
    dom.removeEventListener('input', onInput)
    dom.removeEventListener('paste', onInput)
    editor.off('transaction', onTransaction)
    el?.removeEventListener('wheel', onWheel)
  }
}
