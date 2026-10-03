import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib/cn'
import { takeEscape } from '@/lib/escape'
import { useApp } from '@/lib/store'

/** The panel's 1px edge line, which sits inside its width. */
const BORDER = 1

/** Pop-up layers (menus, lists, dialogs) a click or Esc inside belongs to, not to the page behind. */
const LAYERS = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]'

const isTextBox = (el: Element | null): boolean =>
  !!el && (el.matches('input, textarea, select') || el.closest('[role="combobox"]') !== null)

export interface FloatingPane {
  /** Called on Esc and on a click outside the pane. */
  onClose: () => void
  /** The accessible name of the button that shows and hides the pane (a click on it isn't "outside"). */
  toggle: string
}

/**
 * A side panel with a drag handle. Width changes are applied directly to the
 * element while dragging (no React re-render per pixel) and saved on release.
 * The contents keep their full width while the panel slides open or shut (the
 * panel clips them), so the text never re-wraps frame by frame.
 *
 * `floating` (a small window): the panel takes no room beside the page and shows over it when open,
 * closing on Esc or a click outside. The contents stay mounted either way, so nothing reloads.
 */
export function ResizablePane({
  side,
  width,
  min = 220,
  max = 520,
  open,
  onResize,
  children,
  className,
  label,
  instant = false,
  floating = null
}: {
  side: 'left' | 'right'
  width: number
  min?: number
  max?: number
  open: boolean
  onResize: (w: number) => void
  children: ReactNode
  className?: string
  label: string
  /** Follow width changes straight away, without easing (while the window is being resized). */
  instant?: boolean
  floating?: FloatingPane | null
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current
      if (!el) return
      e.preventDefault()
      const startX = e.clientX
      const startW = el.getBoundingClientRect().width
      let w = startW
      el.style.transition = 'none'
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX
        w = Math.round(Math.min(max, Math.max(min, side === 'left' ? startW + dx : startW - dx)))
        el.style.width = `${w}px`
        if (innerRef.current) innerRef.current.style.width = `${w - BORDER}px`
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
        el.style.transition = ''
        onResize(w)
      }
      document.body.style.cursor = 'col-resize'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [max, min, onResize, side]
  )

  // Floating and open: the keyboard goes into it (onto the tree's current row, so the arrows and Enter
  // work at once); Esc or a click outside closes it.
  const floatOpen = !!floating && open
  const floatingRef = useRef(floating)
  floatingRef.current = floating
  useEffect(() => {
    if (!floatOpen) return
    const inner = innerRef.current
    if (inner && !inner.contains(document.activeElement)) {
      const row = inner.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
      ;(row ?? inner).focus({ preventScroll: true })
      row?.scrollIntoView({ block: 'nearest' })
    }
    const toggleButton = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[aria-label="${floatingRef.current?.toggle ?? ''}"]`)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      // Esc in a menu or a text box (renaming a scene) belongs to that first.
      if (target && (target.closest(LAYERS) || (inner?.contains(target) && isTextBox(target)))) return
      e.preventDefault()
      // Closing it is all this Esc does (a draft being written carries on).
      takeEscape(e)
      const wasInside = !!inner?.contains(document.activeElement)
      floatingRef.current?.onClose()
      if (wasInside) toggleButton()?.focus()
    }
    const onDown = (e: PointerEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      if (!target || inner?.contains(target) || target.closest(LAYERS) || toggleButton()?.contains(target)) return
      floatingRef.current?.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [floatOpen])

  return (
    <aside
      ref={ref}
      // Floating, the panel over the page is the landmark (this takes no room and holds it in place).
      role={floating ? 'none' : undefined}
      aria-label={floating ? undefined : label}
      style={{ width: floating || !open ? 0 : width }}
      className={cn(
        'relative flex shrink-0 flex-col',
        floating ? 'z-30 overflow-visible' : 'overflow-hidden bg-surface look-new:bg-transparent',
        !instant && !floating && 'transition-[width] duration-200 ease-out',
        !floating && (side === 'left' ? 'border-r border-line' : 'border-l border-line'),
        // The New look: the panes sit a step up from the window's frame, with no hairline.
        !floating && 'look-new:border-transparent',
        !floating && !open && 'border-transparent',
        className
      )}
    >
      <div
        ref={innerRef}
        role={floating ? 'complementary' : undefined}
        aria-label={floating ? label : undefined}
        tabIndex={floating ? -1 : undefined}
        className={cn(
          'flex h-full flex-col',
          side === 'right' && !floating && 'self-end',
          floating && 'absolute inset-y-0 bg-surface shadow-pop focus:outline-none',
          floating && (side === 'left' ? 'left-0 border-r border-line' : 'right-0 border-l border-line'),
          floating && (open ? 'animate-fade-in' : 'hidden')
        )}
        style={{ width: floating ? width : width - BORDER }}
      >
        {children}
      </div>
      {open && !floating ? (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onPointerDown}
          className={cn(
            'absolute top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-accent/25',
            side === 'left' ? '-right-0.5' : '-left-0.5'
          )}
        />
      ) : null}
    </aside>
  )
}

/** The binder floating over the page in a small window: whether it floats now, and whether it shows. */
export const useFloatingBinder = create<{ floating: boolean; open: boolean }>(() => ({ floating: false, open: false }))

/** Shows or hides the floating binder (for the top bar's binder button while the binder floats). */
export function toggleFloatingBinder(): void {
  const { floating, open } = useFloatingBinder.getState()
  if (floating) useFloatingBinder.setState({ open: !open })
}

/**
 * Whether the binder floating over the page shows (see ResizablePane's `floating`). While `active`,
 * the top bar's binder button and the palette's "Show or hide the binder" show and hide it with
 * toggleFloatingBinder() instead of changing the saved layout; picking a scene or another page
 * closes it. It starts closed whenever the binder starts floating.
 */
export function useFloatingPane(active: boolean): { open: boolean; close: () => void } {
  const open = useFloatingBinder((s) => s.open)
  const close = useCallback(() => useFloatingBinder.setState({ open: false }), [])

  useEffect(() => {
    useFloatingBinder.setState({ floating: active, open: false })
    if (!active) return
    // Picking something in it (a scene, a page) is what it was opened for.
    const off = useApp.subscribe((s, prev) => {
      if (s.sceneId !== prev.sceneId || s.view !== prev.view || s.storyId !== prev.storyId) close()
    })
    return () => {
      off()
      useFloatingBinder.setState({ floating: false, open: false })
    }
  }, [active, close])

  return { open: active && open, close }
}
