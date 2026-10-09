import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { create } from 'zustand'
import { CircleAlert, X } from '@/components/ui/icons'
import { DrawnTick } from './DrawnTick'
import { Spinner } from './Spinner'
import './toast.css'
import { cn } from '@/lib/cn'
import { useNewLook } from '@/features/look/look'
import { reducedMotion } from '@/features/look/motion'
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
  opts: { tone?: ToastItem['tone']; action?: ToastItem['action']; secondary?: ToastItem['secondary']; progress?: number | null } = {}
): number =>
  useToasts
    .getState()
    .push({ message, tone: opts.tone ?? 'neutral', action: opts.action, secondary: opts.secondary, ...(opts.progress !== undefined ? { progress: opts.progress } : {}) })

/** The New look's glide (styles.css: --motion-glide), for the stack moving into place. */
const GLIDE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
/** How long the stack takes to move into place (styles.css: --dur-base). */
const SETTLE_MS = 220

export function Toaster(): React.JSX.Element {
  const items = useToasts((s) => s.items)
  const lift = useToasts((s) => s.lift)
  const isNew = useNewLook()
  const moving = isNew && !reducedMotion()
  // The New look: a toast that goes stays a moment, in its place, to leave the way it came (its "ghost"). Worked out
  // while drawing, so the toast is never taken off the page in between: the same element plays its way out.
  const [ghosts, setGhosts] = useState<{ t: ToastItem; at: number }[]>([])
  const [seen, setSeen] = useState(items)
  if (seen !== items) {
    setSeen(items)
    const gone = moving ? seen.flatMap((t, at) => (items.some((i) => i.id === t.id) ? [] : [{ t, at }])) : []
    if (gone.length) setGhosts((g) => [...g.filter((x) => !gone.some((y) => y.t.id === x.t.id)), ...gone])
    else if (!moving && ghosts.length) setGhosts([])
  }
  const drop = useCallback((id: number): void => setGhosts((g) => g.filter((x) => x.t.id !== id)), [])
  // The list as drawn: the toasts showing, with each ghost back where it was.
  const shown: { t: ToastItem; leaving: boolean }[] = items.map((t) => ({ t, leaving: false }))
  for (const g of [...ghosts].sort((a, b) => a.at - b.at)) {
    if (!shown.some((s) => s.t.id === g.t.id)) shown.splice(Math.min(g.at, shown.length), 0, { t: g.t, leaving: true })
  }

  // The New look: when the list changes, the toasts that moved glide from where they were to where they are now
  // (measured by layout, so a glide under way carries on from where it has got to rather than starting over).
  const list = useRef<HTMLDivElement>(null)
  const tops = useRef(new Map<string, number>())
  const glides = useRef(new WeakMap<HTMLElement, Animation>())
  useLayoutEffect(() => {
    const box = list.current
    if (!box) return
    const next = new Map<string, number>()
    for (const node of box.querySelectorAll<HTMLElement>(':scope > [data-toast]')) {
      const id = node.dataset.toast!
      const top = box.offsetTop + node.offsetTop
      next.set(id, top)
      const old = tops.current.get(id)
      if (!moving || old === undefined) continue
      // Where it shows now: where it was laid out, plus how far an unfinished glide still has it.
      const running = glides.current.get(node)
      const still = running && running.playState === 'running' ? new DOMMatrixReadOnly(getComputedStyle(node).transform).m42 : 0
      const from = old + still - top
      if (Math.abs(from) < 1) continue
      running?.cancel()
      glides.current.set(node, node.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], { duration: SETTLE_MS, easing: GLIDE }))
    }
    tops.current = next
  })

  // A panel along the right that toasts mustn't cover (Ask the world, whose newest words and box are at
  // the bottom) sets --toast-right to its width, and toasts show beside it instead. data-toaster: they stay in view
  // while a page crossfades under them (styles.css). The New look lifts them over a bar with a transform, not `bottom`.
  return (
    <div
      ref={list}
      data-toaster
      className={cn(
        'pointer-events-none fixed bottom-4 right-[calc(1rem_+_var(--toast-right,0px))] z-[60] flex w-[360px] flex-col gap-2',
        isNew ? 'transition-transform duration-(--dur-base) ease-glide' : 'transition-[bottom] duration-200'
      )}
      style={lift ? (isNew ? { transform: `translateY(${-(lift + 8 - 16)}px)` } : { bottom: lift + 8 }) : undefined}
      aria-live="polite"
    >
      {shown.map(({ t, leaving }) => (
        <Toast key={t.id} t={t} leaving={leaving} onGone={drop} />
      ))}
    </div>
  )
}

/**
 * One toast. Its time only runs while the pointer isn't over it and keyboard focus isn't in it. `leaving`: the New
 * look's ghost of a toast that has gone, playing its way out (lifeless), until `onGone`.
 */
function Toast({ t, leaving = false, onGone }: { t: ToastItem; leaving?: boolean; onGone?: (id: number) => void }): React.JSX.Element {
  const dismiss = useToasts((s) => s.dismiss)
  const isNew = useNewLook()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const left = useRef(toastDuration(t))
  const seenRev = useRef(t.rev)
  const gone = useRef(onGone)
  gone.current = onGone

  // A leaving toast goes when its animation ends, or after this at the latest.
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => gone.current?.(t.id), 400)
    return () => clearTimeout(timer)
  }, [leaving, t.id])

  useEffect(() => {
    if (leaving) return
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
  }, [paused, t.rev, t.id, dismiss, leaving])

  return (
    <div
      data-toast={t.id}
      // A ghost (the New look) takes no clicks, no keys and no screen reader's attention while it plays its way out.
      data-leaving={leaving || undefined}
      inert={leaving}
      aria-hidden={leaving || undefined}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget && e.animationName === 'toast-out') gone.current?.(t.id)
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      className={cn(
        'pointer-events-auto relative flex items-start gap-3 rounded-lg look-new:overflow-hidden border bg-surface px-3.5 py-2.5 text-[13px] shadow-pop animate-slide-up',
        // The New look: a raised card that springs up into place.
        'look-new:rounded-xl look-new:bg-raise look-new:shadow-e3 look-new:[animation:toast-in_var(--dur-base)_var(--motion-spring)_both]',
        t.tone === 'danger' ? 'border-danger/40' : t.tone === 'success' ? 'border-success/40' : 'border-line look-new:border-transparent look-new:ring-1 look-new:ring-line'
      )}
    >
      {/* The New look: a mark for how it went (a tick drawing itself, or a warning), or a long job under way. */}
      {isNew && (t.tone !== 'neutral' || t.progress !== undefined) ? <ToneMark t={t} /> : null}
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
      {/* The New look: a long job's progress, as ink filling along the toast's foot. */}
      {isNew && t.progress !== undefined ? (
        <span aria-hidden className="toast-progress" data-known={t.progress != null || undefined}>
          <i style={t.progress != null ? { transform: `scaleX(${Math.max(0.02, Math.min(1, t.progress))})` } : undefined} />
        </span>
      ) : null}
    </div>
  )
}

/** The New look's mark at a toast's start: a tick that draws itself, a warning, or a page filling for a job under way. */
function ToneMark({ t }: { t: ToastItem }): React.JSX.Element {
  if (t.progress !== undefined && t.tone === 'neutral') {
    return (
      <span aria-hidden className="toast-mark is-busy">
        <Spinner size={13} />
      </span>
    )
  }
  return (
    <span aria-hidden className={cn('toast-mark', t.tone === 'danger' ? 'is-danger' : 'is-success')}>
      {t.tone === 'danger' ? <CircleAlert size={14} /> : <DrawnTick size={13} draw />}
    </span>
  )
}
