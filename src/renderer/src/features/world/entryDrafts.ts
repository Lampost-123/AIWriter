// The newest local copy of each entry that is being edited and not yet confirmed
// saved. Lists overlay these on what they load, and a form re-opened before its
// last write lands starts from here, so a slow write can never show (or bring
// back) older text.

import type { Entry, ID } from '@shared/types'

const drafts = new Map<ID, Entry>()

export const getDraft = (id: ID): Entry | undefined => drafts.get(id)

export function setDraft(e: Entry): void {
  drafts.set(e.id, e)
}

/** Call after `e` was written. Forgets it unless a newer edit has replaced it. */
export function confirmSaved(e: Entry): void {
  if (drafts.get(e.id) === e) drafts.delete(e.id)
}

export function forgetDraft(id: ID): void {
  drafts.delete(id)
}

/** The loaded list with any newer local edits laid over it. */
export const withDrafts = (list: Entry[]): Entry[] => (drafts.size ? list.map((e) => drafts.get(e.id) ?? e) : list)

// Entries created a moment ago, so their form opens with the name selected, ready to type over.
const fresh = new Set<ID>()
export const markFresh = (id: ID): void => void fresh.add(id)
/** True once for a freshly created entry. */
export function takeFresh(id: ID): boolean {
  return fresh.delete(id)
}
