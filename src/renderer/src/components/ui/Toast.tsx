import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { addToast, type ToastInput, type ToastItem } from './toastQueue'

interface ToastState {
  items: ToastItem[]
  /** Shows a toast and returns its id. */
  push: (t: ToastInput) => number
  /** Changes a toast still showing (e.g. "2 scenes deleted") and restarts its time. */
  update: (id: number, patch: Partial<ToastInput>) => void
  dismiss: (id: number) => void
  /** Removes every toast with a button (e.g. Undo); plain messages stay. */
  clearActions: () => void
  /** How far up from the window's foot a bar showing along it reaches (px): the toasts sit above it. */
  lift: number
}

/** How long a toast stays while the pointer and keyboard are elsewhere. */
const toastDuration = (t: Pick<ToastItem, 'tone' | 'action'>): number => (t.action ? 15000 : t.tone === 'danger' ? 9000 : 5000)

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const next = addToast(get().items, t, ++seq)
    set({ items: next.items })
    return next.id
  },
  update: (id, patch) => set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch, rev: i.rev + 1 } : i)) }),
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
  clearActions: () => set({ items: get().items.filter((i) => !i.action) }),
  lift: 0
}))

// The bars kept clear of the toasts, by a number of their own, and how far up each reaches.
const bars = new Map<number, number>()
let barSeq = 0

/**
 * Keeps the toasts above a bar along the foot of the window while it shows (the builder's buttons, the
 * interview's question box), so a toast, and its Undo for 15 seconds, never covers it. The highest
 * bar showing wins; a hidden one counts for nothing.
 */
export function useToastsAbove(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const id = ++barSeq
    const measure = (): void => {
      const box = el.getBoundingClientRect()
      bars.set(id, box.height ? Math.max(0, window.innerHeight - box.top) : 0)
      useToasts.setState({ lift: Math.max(0, ...bars.values()) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      bars.delete(id)
      useToasts.setState({ lift: Math.max(0, ...bars.values()) })
    }
  }, [ref])
}

/** Shows a short message in the corner and returns its id. Use for undoable actions ("Scene deleted · Undo") and errors. */
export const toast = (
  message: string,
  opts: { tone?: ToastItem['tone']; action?: ToastItem['action']; secondary?: ToastItem['secondary'] } = {}
): number => useToasts.getState().push({ message, tone: opts.tone ?? 'neutral', action: opts.action, secondary: opts.secondary })

export function Toaster(): React.JSX.Element {
  const items = useToasts((s) => s.items)
  const lift = useToasts((s) => s.lift)
  // A panel along the right that toasts mustn't cover (Ask the world, whose newest words and box are at
  // the bottom) sets --toast-right to its width, and toasts show beside it instead.
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-[calc(1rem_+_var(--toast-right,0px))] z-[60] flex w-[360px] flex-col gap-2 transition-[bottom] duration-200"
      style={lift ? { bottom: lift + 8 } : undefined}
      aria-live="polite"
    >
      {items.map((t) => (
        <Toast key={t.id} t={t} />
      ))}
    </div>
  )
}

/** One toast. Its time only runs while the pointer isn't over it and keyboard focus isn't in it. */
function Toast({ t }: { t: ToastItem }): React.JSX.Element {
  const dismiss = useToasts((s) => s.dismiss)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const left = useRef(toastDuration(t))
  const seenRev = useRef(t.rev)

  useEffect(() => {
    if (seenRev.current !== t.rev) {
      seenRev.current = t.rev
      left.current = toastDuration(t)
    }
    if (paused) return
    const started = Date.now()
    // After a pause, leave a moment to read it again rather than vanishing as the pointer moves off.
    const timer = setTimeout(() => dismiss(t.id), Math.max(left.current, 1500))
    return () => {
      clearTimeout(timer)
      left.current = Math.max(0, left.current - (Date.now() - started))
    }
    // The duration only changes with rev, so `t` itself isn't a dependency.
  }, [paused, t.rev, t.id, dismiss])

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-3.5 py-2.5 text-[13px] shadow-pop animate-slide-up',
        t.tone === 'danger' ? 'border-danger/40' : t.tone === 'success' ? 'border-success/40' : 'border-line'
      )}
    >
      {/* A long file path or web address wraps inside the toast rather than running off the window. */}
      <p className="min-w-0 flex-1 leading-relaxed text-fg [overflow-wrap:anywhere]">{t.message}</p>
      {t.secondary ? (
        <button className="font-medium text-muted hover:text-fg hover:underline" onClick={() => t.secondary!.run()}>
          {t.secondary.label}
        </button>
      ) : null}
      {t.action ? (
        <button
          className="font-medium text-accent hover:underline"
          onClick={() => {
            t.action!.run()
            dismiss(t.id)
          }}
        >
          {t.action.label}
        </button>
      ) : null}
      <button className="text-faint hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}
