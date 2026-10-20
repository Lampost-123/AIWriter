// Write in what a draft missed (2026-10-19; Settings › Models, off by default, Settings.autoWriteIn): when the direction
// receipt shows an ask that didn't land (○, never one of length), the app writes it in once by itself, with the same
// steered Continue "Write it in" uses (features/edits/continue.ts continueAtEnd), before Adam looks; the receipt then says
// what was written in, and the Continue waits for him to keep or not as any Continue does. At most once a draft, and only
// for a draft this window started (a receipt read again after a restart is never written in by itself). The decision is
// pure (autoWriteInFor); what was claimed and written in is kept for the session.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { toWriteIn, writeInDirection, type Receipt } from './receipt'

/** The drafts this window started (Generate, Add below), by record. */
const startedHere = new Set<ID>()
/** The drafts whose missing asks have been written in by themselves (or tried): never again. */
const claimed = new Set<ID>()
/** What was written in for each draft, in Adam's own words. */
const written = new Map<ID, string[]>()

let watching = false

/** Notes each draft this window starts (the app's active draft), once, for as long as the window is open. */
export function watchDraftsStarted(): void {
  if (watching) return
  watching = true
  const now = useApp.getState().activeGeneration?.id
  if (now) startedHere.add(now)
  useApp.subscribe((a, prev) => {
    const id = a.activeGeneration?.id
    if (id && id !== prev.activeGeneration?.id) startedHere.add(id)
  })
}

/** A draft this window started (also for tests). */
export const noteStartedHere = (recordId: ID): void => void startedHere.add(recordId)
export const wasStartedHere = (recordId: ID): boolean => startedHere.has(recordId)
export const wasClaimed = (recordId: ID): boolean => claimed.has(recordId)

/**
 * What to write in by itself for this receipt: the asks that didn't land and can be written in (never one of length), as
 * "Write it in" would ask Continue for them; null when the setting is off, the draft wasn't started in this window, it was
 * written in already (or tried), or nothing is missing.
 */
export function autoWriteInFor(r: Pick<Receipt, 'asks'>, o: { on: boolean; startedHere: boolean; claimed: boolean }): string | null {
  if (!o.on || !o.startedHere || o.claimed) return null
  return writeInDirection(r) || null
}

/** Claims the draft's one write-in: true the first time only. */
export function claimAutoWriteIn(recordId: ID): boolean {
  if (claimed.has(recordId)) return false
  claimed.add(recordId)
  return true
}

/** Keeps what was written in for a draft (its missing asks, as Adam wrote them). */
export function markWrittenIn(r: Pick<Receipt, 'recordId' | 'asks'>): void {
  written.set(
    r.recordId,
    toWriteIn(r).map((a) => a.text)
  )
}

/** What was written in by itself for a draft, or null when nothing was. */
export const writtenInFor = (recordId: ID): string[] | null => written.get(recordId) ?? null

/** Forgets it all (tests). */
export function resetAutoWriteIn(): void {
  startedHere.clear()
  claimed.clear()
  written.clear()
}
