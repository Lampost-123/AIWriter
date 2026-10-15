// A plot thread's plan (the promises ledger, long story memory fix 10): "Pay off by" a chapter, and Mark as dropped or
// Pick up again, from the board in either look and from Worth a look. Each is kept at once (api.planThread) and says
// what it did in a toast with Undo; the board, Worth a look and the AI writer read it again (memory:changed).
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { payByToast, droppedToast } from './planWords'

const undoWith = (undo: Awaited<ReturnType<typeof api.planThread>>): void =>
  void api.undoMemoryCheck(undo).catch((e: unknown) => void toast(`That couldn't be undone. ${plainReason(e)}`, { tone: 'danger' }))

/** Sets (or clears, with null) the chapter a thread should be paid off by. `chapter`: its words ("Ch 5"). */
export async function setPayBy(thread: { id: ID; name: string }, chapterId: ID | null, chapter: string): Promise<boolean> {
  try {
    const undo = await api.planThread(thread.id, { payBy: chapterId })
    toast(payByToast(thread.name, chapterId ? chapter : null), { action: { label: 'Undo', run: () => undoWith(undo) } })
    return true
  } catch (e) {
    toast(`That couldn't be changed. ${plainReason(e)}`, { tone: 'danger' })
    return false
  }
}

/** Marks a thread as dropped (the AI stops bringing it up), or picks it up again. */
export async function setDropped(thread: { id: ID; name: string }, dropped: boolean): Promise<boolean> {
  try {
    const undo = await api.planThread(thread.id, { dropped })
    toast(droppedToast(thread.name, dropped), { action: { label: 'Undo', run: () => undoWith(undo) } })
    return true
  } catch (e) {
    toast(`That couldn't be changed. ${plainReason(e)}`, { tone: 'danger' })
    return false
  }
}
