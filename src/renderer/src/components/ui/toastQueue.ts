// Which toasts show. Pure (no React, no window), so it is unit-tested.

export interface ToastItem {
  id: number
  message: string
  tone: 'neutral' | 'danger' | 'success'
  action?: { label: string; run: () => void }
  /** A second button before the action ("Open" beside "Undo"). It leaves the toast showing, so Undo stays at hand. */
  secondary?: { label: string; run: () => void }
  /** A long job's progress (0 to 1) shown along the toast's foot in the New look; null while it can't say. */
  progress?: number | null
  /** Bumped when the toast is changed in place, which gives it its full time again. */
  rev: number
}

export type ToastInput = Omit<ToastItem, 'id' | 'rev'>

/** At most this many show: the oldest plain messages make room. Toasts with a button (Undo) are never pushed out. */
export const MAX_SHOWN = 3

/**
 * The toasts after showing `t` as toast `id`. A plain message that is already showing (the same
 * words, saying the same thing again: pressing a key twice, say) isn't shown twice: that toast gets
 * its full time again instead. Returns the toasts and the id of the one now showing the message.
 */
export function addToast(items: ToastItem[], t: ToastInput, id: number): { items: ToastItem[]; id: number } {
  if (!t.action) {
    const same = items.find((i) => !i.action && i.message === t.message && i.tone === t.tone)
    if (same) return { items: items.map((i) => (i === same ? { ...i, rev: i.rev + 1 } : i)), id: same.id }
  }
  const next = [...items, { ...t, id, rev: 0 }]
  let extra = next.length - MAX_SHOWN
  return {
    items: next.filter((i) => {
      if (extra <= 0 || i.action || i.id === id) return true
      extra--
      return false
    }),
    id
  }
}
