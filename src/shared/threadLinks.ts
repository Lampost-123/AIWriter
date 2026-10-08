// Plot thread links on a scene card that the memory made (2026-10-08, the AI manages plot threads). When the memory
// keeper reads a plot thread opening in a scene, the thread goes on that scene's "Sets up"; when it reads the payoff,
// on its "Pays off". Such a link is marked 'ai' in the card's `threadLinks` (no migration: the card is JSON), shown
// with an AI tag and removable. Adam's own links are never marked and never taken off by the memory. Pure, so the
// rules are unit-tested (threadLinks.test.ts).
import type { ID, SceneCard, ThreadLinkMark } from './types'

export type ThreadList = 'setsUp' | 'paysOff'

const LIST_KEY: Record<ThreadList, 'setsUpIds' | 'paysOffIds'> = { setsUp: 'setsUpIds', paysOff: 'paysOffIds' }

export const threadLinkKey = (list: ThreadList, threadId: ID): string => `${list}:${threadId}`

type Card = Pick<SceneCard, 'setsUpIds' | 'paysOffIds' | 'threadLinks'>

const idsOf = (card: Card, list: ThreadList): ID[] => card[LIST_KEY[list]] ?? []
const markOf = (card: Card, list: ThreadList, id: ID): ThreadLinkMark | undefined => card.threadLinks?.[threadLinkKey(list, id)]

/** True when the memory made this link (and it is still on the card). */
export function isAiLink(card: Card, list: ThreadList, threadId: ID): boolean {
  return idsOf(card, list).includes(threadId) && markOf(card, list, threadId) === 'ai'
}

/** The threads on one list that the memory linked. */
export function aiLinked(card: Card, list: ThreadList): Set<ID> {
  return new Set(idsOf(card, list).filter((id) => markOf(card, list, id) === 'ai'))
}

/**
 * The card with the memory's link added, or null when nothing changes: the thread is on the list already (Adam's link
 * or the memory's), or Adam took the memory's link to it off before.
 */
export function withAiLink<C extends Card>(card: C, list: ThreadList, threadId: ID): C | null {
  if (idsOf(card, list).includes(threadId) || markOf(card, list, threadId) === 'removed') return null
  return {
    ...card,
    [LIST_KEY[list]]: [...idsOf(card, list), threadId],
    threadLinks: { ...(card.threadLinks ?? {}), [threadLinkKey(list, threadId)]: 'ai' }
  }
}

/** The card with the memory's own link taken back (after an Undo), or null when it isn't the memory's: Adam's stays. */
export function withoutAiLink<C extends Card>(card: C, list: ThreadList, threadId: ID): C | null {
  if (markOf(card, list, threadId) !== 'ai') return null
  return {
    ...card,
    [LIST_KEY[list]]: idsOf(card, list).filter((id) => id !== threadId),
    threadLinks: { ...(card.threadLinks ?? {}), [threadLinkKey(list, threadId)]: 'undone' }
  }
}

/**
 * Adam changed a list on the card: a memory link he took off is marked 'removed' (never put back), and one he adds
 * by hand is his (its mark goes).
 */
export function withListEdited<C extends Card>(card: C, list: ThreadList, next: ID[]): C {
  const before = new Set(idsOf(card, list))
  const after = new Set(next)
  const marks = { ...(card.threadLinks ?? {}) }
  for (const id of before) if (!after.has(id) && marks[threadLinkKey(list, id)] === 'ai') marks[threadLinkKey(list, id)] = 'removed'
  for (const id of after) if (!before.has(id)) delete marks[threadLinkKey(list, id)]
  const out = { ...card, [LIST_KEY[list]]: next }
  if (Object.keys(marks).length) out.threadLinks = marks
  else delete out.threadLinks
  return out
}

/**
 * A card as saved from the scene card panel, with what the memory did to its links since the panel read it: a link the
 * memory added meanwhile (marked 'ai' on disk, not known to the panel) is kept, and one it took back meanwhile (marked
 * 'undone' on disk, still 'ai' in the panel) stays gone. Everything else is as the panel sends it.
 */
export function mergeThreadLinks<C extends Card>(disk: Card | null, incoming: C): C {
  if (!disk?.threadLinks) return incoming
  const marks = disk.threadLinks
  let out = incoming
  for (const [key, mark] of Object.entries(marks)) {
    const at = key.indexOf(':')
    const list = key.slice(0, at) as ThreadList
    const id = key.slice(at + 1)
    if (!(list in LIST_KEY) || !id) continue
    const now = out.threadLinks?.[key]
    if (mark === 'ai' && now === undefined && !idsOf(out, list).includes(id)) {
      if (!idsOf(disk, list).includes(id)) continue
      out = { ...out, [LIST_KEY[list]]: [...idsOf(out, list), id], threadLinks: { ...(out.threadLinks ?? {}), [key]: 'ai' } }
    } else if (mark === 'undone' && now === 'ai') {
      out = { ...out, [LIST_KEY[list]]: idsOf(out, list).filter((x) => x !== id), threadLinks: { ...(out.threadLinks ?? {}), [key]: 'undone' } }
    }
  }
  return out
}
