import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ToastItem {
  id: number
  message: string
  tone: 'neutral' | 'danger' | 'success'
  action?: { label: string; run: () => void }
  /** Bumped when the toast is changed in place, which gives it its full time again. */
  rev: number
}

type ToastInput = Omit<ToastItem, 'id' | 'rev'>

interface ToastState {
  items: ToastItem[]
  /** Shows a toast and returns its id. */
  push: (t: ToastInput) => number
  /** Changes a toast still showing (e.g. "2 scenes deleted") and restarts its time. */
  update: (id: number, patch: Partial<ToastInput>) => void
  dismiss: (id: number) => void
  /** Removes every toast with a button (e.g. Undo); plain messages stay. */
  clearActions: () => void
}

/** At most this many show: the oldest plain messages make room. Toasts with a button (Undo) are never pushed out. */
const MAX_SHOWN = 3

/** How long a toast stays while the pointer and keyboard are elsewhere. */
const toastDuration = (t: Pick<ToastItem, 'tone' | 'action'>): number => (t.action ? 15000 : t.tone === 'danger' ? 9000 : 5000)

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = ++seq
    const items = [...get().items, { ...t, id, rev: 0 }]
    let extra = items.length - MAX_SHOWN
    set({
      items: items.filter((i) => {
        if (extra <= 0 || i.action || i.id === id) return true
        extra--
        return false
      })
    })
    return id
  },
  update: (id, patch) => set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch, rev: i.rev + 1 } : i)) }),
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
  clearActions: () => set({ items: get().items.filter((i) => !i.action) })
}))

/** Shows a short message in the corner and returns its id. Use for undoable actions ("Scene deleted · Undo") and errors. */
export const toast = (message: string, opts: { tone?: ToastItem['tone']; action?: ToastItem['action'] } = {}): number =>
  useToasts.getState().push({ message, tone: opts.tone ?? 'neutral', action: opts.action })

export function Toaster(): React.JSX.Element {
  const items = useToasts((s) => s.items)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
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
      <p className="flex-1 leading-relaxed text-fg">{t.message}</p>
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
