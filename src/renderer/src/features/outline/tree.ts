// The outline helper's suggestions as one tree (acts, chapters, scene cards) and what Adam has decided
// about each part: kept (added to the story, with what it became), discarded, or still open, with any
// changes he made to its words. From these it works out what one click on Keep adds, and where, and
// what Discard takes away. No React, so it is unit-tested.
import type { KeepItem, KeepRef, KeptItem } from '@shared/contracts/outline'
import type { ID } from '@shared/types'
import type { ParsedOutline, SuggestedChapter } from './parse'

export type NodeKind = 'act' | 'chapter' | 'scene'

export interface TreeNode {
  key: string
  kind: NodeKind
  title: string
  /** An act's purpose, a chapter's goal, or what happens in a scene. */
  text: string
  /** A scene's beats. */
  beats: string[]
  /** Fully arrived (see parse.ts). */
  complete: boolean
  children: TreeNode[]
}

/** Adam's own words for a suggestion, in place of the AI's. */
export interface NodeEdit {
  title: string
  text: string
  beats: string[]
}

/** What became of a suggestion. Not listed: still open. */
export type Decision = { status: 'kept'; id: ID } | { status: 'discarded' }

export type Decisions = Record<string, Decision>
export type Edits = Record<string, NodeEdit>

export interface Counts {
  acts: number
  chapters: number
  scenes: number
}

const chapterNode = (c: SuggestedChapter): TreeNode => ({
  key: c.key,
  kind: 'chapter',
  title: c.title,
  text: c.goal,
  beats: [],
  complete: c.complete,
  children: c.scenes.map((s) => ({
    key: s.key,
    kind: 'scene',
    title: s.title,
    text: s.summary,
    beats: s.beats,
    complete: s.complete,
    children: []
  }))
})

/** A parsed reply as one tree: any chapters before the first act, then the acts. */
export function outlineTree(o: ParsedOutline): TreeNode[] {
  return [
    ...o.chapters.map(chapterNode),
    ...o.acts.map(
      (a): TreeNode => ({
        key: a.key,
        kind: 'act',
        title: a.title,
        text: a.purpose,
        beats: [],
        complete: a.complete,
        children: a.chapters.map(chapterNode)
      })
    )
  ]
}

interface Place {
  node: TreeNode
  parent: TreeNode | null
  /** The node and the others of its kind under the same parent, in order. */
  siblings: TreeNode[]
}

/** Every node in reading order (each before what it holds), with its parent and siblings. */
function places(tree: TreeNode[]): Place[] {
  const out: Place[] = []
  const visit = (nodes: TreeNode[], parent: TreeNode | null): void => {
    for (const node of nodes) {
      out.push({ node, parent, siblings: nodes.filter((n) => n.kind === node.kind) })
      visit(node.children, node)
    }
  }
  visit(tree, null)
  return out
}

/** The node with this key, if the tree has it. */
export function findNode(tree: TreeNode[], key: string): TreeNode | null {
  return places(tree).find((p) => p.node.key === key)?.node ?? null
}

export const isOpen = (decisions: Decisions, key: string): boolean => !decisions[key]

/** The node, then everything under it, in reading order. */
function within(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(within)]
}

/**
 * What Keep on these suggestions adds to the story, in the order to make it: each one with everything
 * still open inside it, and the open act and chapter around it (a scene needs its chapter). Each goes
 * after the nearest one before it that is kept or being kept, else before the nearest kept one after
 * it, else at the end of where it goes. Adam's changes take the place of the AI's words. `keys` 'all':
 * every open suggestion ("Keep all that's left").
 */
export function keepPlan(tree: TreeNode[], decisions: Decisions, edits: Edits, keys: string[] | 'all'): KeepItem[] {
  const all = places(tree)
  const byKey = new Map(all.map((p) => [p.node.key, p]))
  const keeping = new Set<string>()
  const add = (node: TreeNode): void => {
    for (const n of within(node)) {
      // Discarded stays discarded, and so does everything inside it.
      if (decisions[n.key]?.status === 'discarded') continue
      if (isOpen(decisions, n.key) && !insideDiscarded(n.key)) keeping.add(n.key)
    }
  }
  const insideDiscarded = (key: string): boolean => {
    for (let p = byKey.get(key)?.parent ?? null; p; p = byKey.get(p.key)?.parent ?? null) {
      if (decisions[p.key]?.status === 'discarded') return true
    }
    return false
  }
  const wanted = keys === 'all' ? all.map((p) => p.node) : keys.map((k) => byKey.get(k)?.node).filter((n): n is TreeNode => !!n)
  for (const node of wanted) {
    if (!isOpen(decisions, node.key) || insideDiscarded(node.key)) continue
    add(node)
    for (let p = byKey.get(node.key)?.parent ?? null; p; p = byKey.get(p.key)?.parent ?? null) {
      if (isOpen(decisions, p.key)) keeping.add(p.key)
    }
  }

  const ref = (n: TreeNode | null | undefined): KeepRef | undefined => {
    if (!n) return undefined
    const d = decisions[n.key]
    if (d?.status === 'kept') return { id: d.id }
    return keeping.has(n.key) ? { key: n.key } : undefined
  }
  const items: KeepItem[] = []
  for (const { node, parent, siblings } of all) {
    if (!keeping.has(node.key)) continue
    const at = siblings.indexOf(node)
    const after = siblings
      .slice(0, at)
      .reverse()
      .find((s) => decisions[s.key]?.status === 'kept' || keeping.has(s.key))
    const before = after ? undefined : siblings.slice(at + 1).find((s) => decisions[s.key]?.status === 'kept')
    const words = edits[node.key] ?? node
    const item: KeepItem = { key: node.key, kind: node.kind, title: words.title.trim(), text: words.text.trim() }
    if (node.kind === 'scene') item.beats = words.beats.map((b) => b.trim()).filter(Boolean)
    const p = ref(parent)
    if (p) item.parent = p
    const a = ref(after)
    if (a) item.after = a
    const b = ref(before)
    if (b) item.before = b
    items.push(item)
  }
  return items
}

/** The decisions once the story has what keepOutline made. */
export function withKept(decisions: Decisions, kept: KeptItem[]): Decisions {
  const next = { ...decisions }
  for (const k of kept) next[k.key] = { status: 'kept', id: k.id }
  return next
}

/** Undo for a keep: those suggestions are open again (unless kept again since, as something new). */
export function withoutKept(decisions: Decisions, kept: KeptItem[]): Decisions {
  const next = { ...decisions }
  for (const k of kept) {
    const d = next[k.key]
    if (d?.status === 'kept' && d.id === k.id) delete next[k.key]
  }
  return next
}

/** What was kept that the story no longer has (deleted from the binder since), of what it has now. */
export function goneIds(decisions: Decisions, present: ReadonlySet<ID>): ID[] {
  return Object.values(decisions).flatMap((d) => (d.status === 'kept' && !present.has(d.id) ? [d.id] : []))
}

/**
 * The decisions as the page shows them: a suggestion kept as something since deleted from the story
 * waits for a decision again, so keeping it (or what is inside it) makes it anew.
 */
export function withoutGone(decisions: Decisions, gone: readonly ID[]): Decisions {
  if (!gone.length) return decisions
  const out = new Set(gone)
  const next: Decisions = {}
  for (const [key, d] of Object.entries(decisions)) if (!(d.status === 'kept' && out.has(d.id))) next[key] = d
  return next
}

/** What Discard on this suggestion takes away: it, and everything still open inside it. */
export function discardKeys(tree: TreeNode[], decisions: Decisions, key: string): string[] {
  const node = findNode(tree, key)
  if (!node || !isOpen(decisions, key)) return []
  return within(node)
    .filter((n) => isOpen(decisions, n.key))
    .map((n) => n.key)
}

export function withDiscarded(decisions: Decisions, keys: string[]): Decisions {
  const next = { ...decisions }
  for (const k of keys) if (!next[k]) next[k] = { status: 'discarded' }
  return next
}

/** Undo for a discard: those suggestions are open again. */
export function withoutDiscarded(decisions: Decisions, keys: string[]): Decisions {
  const next = { ...decisions }
  for (const k of keys) if (next[k]?.status === 'discarded') delete next[k]
  return next
}

/** How many acts, chapters and scenes of the tree are in a given state ('open', 'kept'), or all of them. */
export function countNodes(tree: TreeNode[], decisions: Decisions, which: 'open' | 'kept' | 'all'): Counts {
  const counts: Counts = { acts: 0, chapters: 0, scenes: 0 }
  for (const { node } of places(tree)) {
    const d = decisions[node.key]
    const match = which === 'all' ? true : which === 'open' ? !d : d?.status === 'kept'
    if (match) counts[node.kind === 'act' ? 'acts' : node.kind === 'chapter' ? 'chapters' : 'scenes']++
  }
  return counts
}

export const countKinds = (kinds: NodeKind[]): Counts => ({
  acts: kinds.filter((k) => k === 'act').length,
  chapters: kinds.filter((k) => k === 'chapter').length,
  scenes: kinds.filter((k) => k === 'scene').length
})

export const totalOf = (c: Counts): number => c.acts + c.chapters + c.scenes

const NOUNS: Record<keyof Counts, [string, string, string]> = {
  acts: ['an act', 'act', 'acts'],
  chapters: ['a chapter', 'chapter', 'chapters'],
  scenes: ['a scene', 'scene', 'scenes']
}

/** "an act, 3 chapters and 9 scenes"; '' for none. */
export function describeCounts(c: Counts): string {
  const parts = (Object.keys(NOUNS) as (keyof Counts)[])
    .filter((k) => c[k] > 0)
    .map((k) => (c[k] === 1 ? NOUNS[k][0] : `${c[k]} ${NOUNS[k][2]}`))
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "3 acts, 9 chapters and 27 scenes" with numbers throughout, for a running count ("1 act so far"). */
export function countLine(c: Counts): string {
  const parts = (Object.keys(NOUNS) as (keyof Counts)[])
    .filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${c[k] === 1 ? NOUNS[k][1] : NOUNS[k][2]}`)
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * The toast after one Keep: "Added “Arrival at the docks” to the story, in a new chapter and act." or
 * "Added “The Arrival” to the story, with 3 chapters and 9 scenes."
 */
export function keptMessage(tree: TreeNode[], clicked: string, items: Pick<KeepItem, 'key' | 'kind' | 'title'>[]): string {
  const main = items.find((i) => i.key === clicked) ?? items[0]
  if (!main) return 'Nothing was added.'
  const title = main.title.trim() || 'it'
  const node = findNode(tree, main.key)
  const inside = new Set(node ? within(node).map((n) => n.key) : [main.key])
  const around = items.filter((i) => !inside.has(i.key)).map((i) => i.kind)
  const under = items.filter((i) => inside.has(i.key) && i.key !== main.key).map((i) => i.kind)
  const named = title === 'it' ? 'it' : `“${title}”`
  let msg = `Added ${named} to the story`
  if (around.length) {
    const words = [around.includes('chapter') ? 'chapter' : '', around.includes('act') ? 'act' : ''].filter(Boolean)
    msg += `, in a new ${words.join(' and ')}`
  }
  if (under.length) msg += `, with ${describeCounts(countKinds(under))}`
  return `${msg}.`
}

/** The toast after one Discard: "Discarded “Rain on the Narrows” and its 2 scenes." */
export function discardedMessage(tree: TreeNode[], keys: string[], edits: Edits): string {
  const main = keys.length ? findNode(tree, keys[0]) : null
  if (!main) return 'Discarded.'
  const title = (edits[main.key]?.title ?? main.title).trim()
  const rest = keys
    .slice(1)
    .map((k) => findNode(tree, k)?.kind)
    .filter((k): k is NodeKind => !!k)
  const named = title ? `“${title}”` : `the ${main.kind}`
  if (!rest.length) return `Discarded ${named}.`
  const c = countKinds(rest)
  // "and its scene", "and its 2 scenes"
  const what = totalOf(c) === 1 ? describeCounts(c).replace(/^an? /, '') : describeCounts(c)
  return `Discarded ${named} and its ${what}.`
}
