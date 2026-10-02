import { create } from 'zustand'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ToastItem {
  id: number
  message: string
  tone: 'neutral' | 'danger' | 'success'
  action?: { label: string; run: () => void }
}

interface ToastState {
  items: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
  /** Removes every toast with a button (e.g. Undo); plain messages stay. */
  clearActions: () => void
}

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = ++seq
    set({ items: [...get().items.slice(-2), { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.tone === 'danger' ? 9000 : 5000)
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
  clearActions: () => set({ items: get().items.filter((i) => !i.action) })
}))

/** Shows a short message in the corner. Use for undoable actions ("Scene deleted · Undo") and errors. */
export const toast = (message: string, opts: { tone?: ToastItem['tone']; action?: ToastItem['action'] } = {}): void =>
  useToasts.getState().push({ message, tone: opts.tone ?? 'neutral', action: opts.action })

export function Toaster(): React.JSX.Element {
  const { items, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
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
      ))}
    </div>
  )
}
