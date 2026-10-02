// Where the story flows put what they write among the changes at a story's start. The order matters:
// the memory applies a story's start-of-story changes in turn (memory/state.ts), and a starting
// description sets its entry afresh (its description, what it knows, and its relationships on both
// sides), so what comes after it counts on top of it and what came before it about that entry is
// wiped. Two changes about different entries mean the same in either order.
// - What a flow drafts goes before the changes already there about the same entries, so those, Adam's
//   above all, still count on top of it.
// - A drafted starting description that names another entry goes after that entry's starting
//   description (unless that one names it back), so the relationship it names is written from its
//   own side and nothing wipes it.
// - A change moved to a new story's start goes before the changes already there, in the order it had
//   on its book among the others moved from there.
// Nothing Adam or the text made is ever moved. Earlier drafted starting descriptions move only when
// they must, and only past changes about other entries, so that never changes what they mean. A
// change goes strictly between its neighbours (a fraction only when they are next to each other), so
// equal positions never decide the order. Pure.

import type { Change, FullPayload, ID } from '@shared/types'
import { entriesTouched } from '../db/memory'

/** A position strictly between two neighbours' (null when there is none on that side). */
export function between(before: number | null, after: number | null): number {
  if (before === null) return after === null ? 0 : after - 1
  if (after === null) return before + 1
  return after - before > 1 ? before + 1 : (before + after) / 2
}

/** The j-th of k new positions strictly between two neighbours', in order. */
function spread(before: number | null, after: number | null, j: number, k: number): number {
  if (before === null) return after === null ? j : after - k + j
  if (after === null || after - before > k) return before + 1 + j
  return before + ((after - before) * (j + 1)) / (k + 1)
}

/** Adds a change to a list of the changes at one place, in order (after any at the same position, as it is the newest). */
export function insertInOrder(list: Change[], c: Change): void {
  const i = list.findIndex((x) => x.position > c.position)
  list.splice(i < 0 ? list.length : i, 0, c)
}

/** True when a change is about any of these entries (its own, or the other side of a relationship it sets). */
export const touchesAny = (c: Change, ids: readonly ID[]): boolean => entriesTouched(c).some((id) => ids.includes(id))

/**
 * Where a change goes to come just before the first of `here` (the changes at that place, in order)
 * that `first` picks: strictly between it and the one before. Null when `first` picks none: the
 * change then goes after the others.
 */
export function positionBefore(here: Change[], first: (c: Change) => boolean): number | null {
  const i = here.findIndex(first)
  return i < 0 ? null : between(i > 0 ? here[i - 1].position : null, here[i].position)
}

/**
 * Where a change moved from a book's start goes at the new story's start (`here`, without it, in
 * order): before the changes already there, but after those moved from the same book that came before
 * it there, so they keep the book's order. `fromBook` gives each change moved from that book its
 * position on the book.
 */
export function movedPosition(here: Change[], bookPosition: number, fromBook: ReadonlyMap<ID, number>): number {
  let i = 0
  here.forEach((c, k) => {
    const p = fromBook.get(c.id)
    if (p !== undefined && p <= bookPosition) i = k + 1
  })
  return between(i > 0 ? here[i - 1].position : null, i < here.length ? here[i].position : null)
}

// ---------- A prequel's starting cast ----------

/** A drafted starting description to place, and the earlier drafted one it replaces. */
export interface CastDraft {
  entryId: ID
  payload: FullPayload
  old: Change | null
}

export interface CastPlacement {
  /** Where each draft goes, by entry. */
  at: Map<ID, number>
  /** Earlier drafted starting descriptions that move to make room, by change id. */
  moved: Map<ID, number>
}

interface Node {
  entryId: ID
  touches: ID[]
  /** For a starting description: the entries its relationships name. */
  names: ID[] | null
  /** fixed: stays where it is; earlier: an earlier drafted starting description; draft: this run's. */
  role: 'fixed' | 'earlier' | 'draft'
  /** Where it is now (where it was, for a description drafted again); null for a new draft. */
  position: number | null
  /** Where it would rather go, when nothing says otherwise. */
  rank: number
  tie: number
  key: ID
}

/** The nodes of the longest run whose positions go up strictly, in list order. */
function longestRising(list: Node[]): Set<Node> {
  const len = list.map(() => 1)
  const prev = list.map(() => -1)
  for (let i = 0; i < list.length; i++) {
    for (let k = 0; k < i; k++) {
      if (list[k].position! < list[i].position! && len[k] + 1 > len[i]) {
        len[i] = len[k] + 1
        prev[i] = k
      }
    }
  }
  const out = new Set<Node>()
  let i = len.reduce((best, n, k) => (n > len[best] ? k : best), 0)
  while (i >= 0 && list.length) {
    out.add(list[i])
    i = prev[i]
  }
  return out
}

/**
 * Where each drafted starting description goes among the changes at a prequel's start (`here`, in
 * order), with any earlier drafted descriptions that have to move to make room. Each draft goes before
 * every change there about its entry (Adam's, the text's, and other descriptions naming it), and after
 * the starting description of each entry it names that doesn't name it back. Where both can't be (the
 * one it names comes after something about its own entry that stays put), the changes about its own
 * entry win.
 */
export function placeCast(here: Change[], drafts: CastDraft[]): CastPlacement {
  const replaced = new Set(drafts.flatMap((d) => (d.old ? [d.old.id] : [])))
  const existing = here.filter((c) => !replaced.has(c.id))
  const nodes: Node[] = existing.map((c, i) => ({
    entryId: c.entryId,
    touches: entriesTouched(c),
    names: c.kind === 'full' ? c.payload.relationships.map((r) => r.otherId) : null,
    role: c.kind === 'full' && c.origin === 'ai' ? 'earlier' : 'fixed',
    position: c.position,
    rank: i,
    tie: 0,
    key: c.id
  }))
  drafts.forEach((d, j) => {
    const first = existing.findIndex((c) => entriesTouched(c).includes(d.entryId))
    // Just before the first change about it; else where it was, when drafted again; else after the others.
    const rank = first >= 0 ? first - 0.5 : d.old ? existing.filter((c) => c.position < d.old!.position).length - 0.5 : existing.length + j
    nodes.push({
      entryId: d.entryId,
      touches: entriesTouched({ kind: 'full', payload: d.payload, entryId: d.entryId }),
      names: d.payload.relationships.map((r) => r.otherId),
      role: 'draft',
      position: d.old?.position ?? null,
      rank,
      tie: j + 1,
      key: d.entryId
    })
  })

  // What must come before what, by index into nodes.
  const after: Set<number>[] = nodes.map(() => new Set())
  const reaches = (from: number, to: number): boolean => {
    const seen = new Set<number>()
    const stack = [from]
    while (stack.length) {
      const i = stack.pop()!
      if (i === to) return true
      if (seen.has(i)) continue
      seen.add(i)
      stack.push(...after[i])
    }
    return false
  }
  const interacts = (a: Node, b: Node): boolean => a.touches.some((id) => b.touches.includes(id))
  const n = existing.length
  // What stays put keeps its order; an earlier draft keeps its order with every change about the same entries.
  let lastFixed = -1
  for (let i = 0; i < n; i++) {
    if (nodes[i].role !== 'fixed') continue
    if (lastFixed >= 0) after[lastFixed].add(i)
    lastFixed = i
  }
  for (let i = 0; i < n; i++) {
    for (let k = i + 1; k < n; k++) {
      if ((nodes[i].role === 'earlier' || nodes[k].role === 'earlier') && interacts(nodes[i], nodes[k])) after[i].add(k)
    }
  }
  // Each draft before every change already there about its entry...
  for (let d = n; d < nodes.length; d++) {
    for (let i = 0; i < n; i++) if (nodes[i].touches.includes(nodes[d].entryId)) after[d].add(i)
  }
  // ...and after the starting description of each entry it names that doesn't name it back, where it can be.
  for (let d = n; d < nodes.length; d++) {
    for (const named of nodes[d].names!) {
      nodes.forEach((g, i) => {
        if (i === d || g.names === null || g.entryId !== named || g.names.includes(nodes[d].entryId)) return
        if (!reaches(d, i)) after[i].add(d)
      })
    }
  }

  // In that order, each where it would rather go when free to choose.
  const waiting = nodes.map(() => 0)
  for (const set of after) for (const k of set) waiting[k]++
  const done = new Set<number>()
  const seq: Node[] = []
  while (seq.length < nodes.length) {
    let pick = -1
    for (let i = 0; i < nodes.length; i++) {
      if (done.has(i) || waiting[i] > 0) continue
      const a = nodes[i]
      const b = pick >= 0 ? nodes[pick] : null
      if (!b || a.rank < b.rank || (a.rank === b.rank && a.tie < b.tie)) pick = i
    }
    done.add(pick)
    seq.push(nodes[pick])
    for (const k of after[pick]) waiting[k]--
  }

  // Positions: what stays put keeps its own; between two of those, as many of the others keep theirs
  // as still go up in order, and the rest get new ones in between.
  const pos = new Map<Node, number>()
  let segment: Node[] = []
  let low: number | null = null
  const settle = (high: number | null): void => {
    const keep = longestRising(
      segment.filter((x) => x.position !== null && (low === null || x.position > low) && (high === null || x.position < high))
    )
    let from = low
    let pending: Node[] = []
    const fill = (to: number | null): void => {
      pending.forEach((x, j) => pos.set(x, spread(from, to, j, pending.length)))
      pending = []
    }
    for (const x of segment) {
      if (!keep.has(x)) {
        pending.push(x)
        continue
      }
      fill(x.position)
      pos.set(x, x.position!)
      from = x.position
    }
    fill(high)
    segment = []
  }
  for (const x of seq) {
    if (x.role !== 'fixed') {
      segment.push(x)
      continue
    }
    settle(x.position)
    pos.set(x, x.position!)
    low = x.position
  }
  settle(null)

  const out: CastPlacement = { at: new Map(), moved: new Map() }
  for (const x of nodes) {
    const p = pos.get(x)!
    if (x.role === 'draft') out.at.set(x.entryId, p)
    else if (x.role === 'earlier' && p !== x.position) out.moved.set(x.key, p)
  }
  return out
}
