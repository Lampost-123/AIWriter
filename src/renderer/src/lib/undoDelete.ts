import { toast, useToasts } from '@/components/ui/Toast'
import { deletedSummary, type Noun } from './deleteWords'

// Deletes happen straight away and are undone from one toast. Deleting more while that toast
// is showing adds to it ("3 scenes deleted · Undo"), so an earlier Undo is never pushed away.
// Whatever the toast no longer offers stays in Recently deleted (Settings) for 30 days.

export interface Deletion {
  /** The toast when this is the only thing in it: "“Scene 3” deleted." */
  message: string
  /**
   * What the delete changed elsewhere, in plain words ("Kell's Road now starts after Book 1, Ch 1 instead."),
   * kept when several deletes share one toast. A single delete's `message` already says it.
   */
  notes?: string[]
  /** For counting several deletes in one toast. */
  noun: Noun
  /** Brings it back and puts the screen right. Shows its own message if that fails. */
  undo: () => Promise<void>
}

interface Batch {
  toastId: number
  items: Deletion[]
}

let batch: Batch | null = null

/** The batch whose toast is still on screen (closed, timed out or dropped on a world switch means gone). */
function live(): Batch | null {
  if (batch && !useToasts.getState().items.some((t) => t.id === batch!.toastId)) batch = null
  return batch
}

const messageFor = (items: Deletion[]): string =>
  items.length === 1 ? items[0].message : [deletedSummary(items.map((d) => d.noun)), ...items.flatMap((d) => d.notes ?? [])].join(' ')

/** Undoes deletes newest first, so a scene deleted before its chapter comes back after the chapter. */
async function undoAll(items: Deletion[]): Promise<void> {
  for (const d of [...items].reverse()) {
    try {
      await d.undo()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }
}

/** Shows (or adds to) the "deleted · Undo" toast. */
export function announceDelete(d: Deletion): void {
  const b = live()
  if (b) {
    b.items.push(d)
    useToasts.getState().update(b.toastId, { message: messageFor(b.items) })
    return
  }
  const next: Batch = { toastId: 0, items: [d] }
  next.toastId = toast(d.message, {
    action: {
      label: 'Undo',
      run: () => {
        if (batch === next) batch = null
        void undoAll(next.items)
      }
    }
  })
  batch = next
}

/** Ctrl+Z outside the editor: undoes the newest delete still offered in the toast. Returns false if there is none. */
export function undoLastDelete(): boolean {
  const b = live()
  const d = b?.items.pop()
  if (!b || !d) return false
  if (b.items.length === 0) {
    useToasts.getState().dismiss(b.toastId)
    batch = null
  } else {
    useToasts.getState().update(b.toastId, { message: messageFor(b.items) })
  }
  void undoAll([d])
  return true
}
