// The outline in stages (2026-10-19, after Adam found the outline helper "extremely poor and hard to use": "A full
// novel" came as up to 96 scene cards in one reply, often cut off, every chapter with the same number of scenes). The
// helper can work a level at a time: first the acts (each with its purpose and about how many chapters), then "Plan its
// chapters" on an act asks for that act's chapters only, and "Plan its scenes" on a chapter for that chapter's scenes,
// as many as it needs. Each reply is small, so it is quick and never cut off. A stage's reply goes into the suggestions'
// own text under the act or chapter it was asked for (after what that holds), so every other suggestion keeps its key,
// and with it Adam's decisions and changes. No React, so it is unit-tested.

import { parseOutline, preambleOf, type SuggestedAct, type SuggestedChapter, type SuggestedScene } from './parse'
import { outlineText } from './outlineText'
import type { Decisions, Edits, TreeNode } from './tree'

/** What a stage asks for under a suggestion: an act's chapters, or a chapter's scenes. */
export type StageLevel = 'chapters' | 'scenes'

/** How the outline helper plans: a level at a time, or the whole outline in one reply (short stories). */
export type PlanMode = 'stages' | 'whole'

/** The most chapters planned all at once (more is planned in stages: one reply that long is slow and often cut off). */
export const WHOLE_MOST_CHAPTERS = 12

/** How a story of this many chapters is planned unless Adam picks: all at once up to WHOLE_MOST_CHAPTERS, else in stages. */
export const defaultMode = (chapters: number): PlanMode => (chapters > WHOLE_MOST_CHAPTERS ? 'stages' : 'whole')

/** True when `key` is `of` or a suggestion inside it ("a1c2s0" is inside "a1c2" and "a1", never inside "a10"). */
export const isUnder = (key: string, of: string): boolean => key === of || (key.startsWith(of) && /^[acs]/.test(key.slice(of.length)))

/** What a stage's reply gives, whole or so far: the chapters (with any scenes the AI gave anyway), or the scenes. */
export function stageParts(reply: string, level: StageLevel, done: boolean): SuggestedChapter[] | SuggestedScene[] {
  const p = parseOutline(reply, done)
  const chapters = [...p.chapters, ...p.acts.flatMap((a) => a.chapters)]
  if (level === 'scenes') return chapters.flatMap((c) => c.scenes)
  // A chapter the reader made up only to hold scenes given with no chapter heading isn't one of the act's chapters.
  return chapters.filter((c) => c.title.trim() && !(/^Chapter \d+$/.test(c.title) && !c.goal && !c.scenes.length))
}

/**
 * The suggestions' text with a stage's reply put inside the act or chapter `key`, after what it holds: every other
 * suggestion, and anything before the first heading (a premise), stays as it was. Null when that act or chapter isn't
 * there any more, or isn't the kind the stage plans inside.
 */
export function spliceStage(text: string, key: string, level: StageLevel, reply: string, done = true): string | null {
  const p = parseOutline(text, true)
  const act: SuggestedAct | undefined = level === 'chapters' ? p.acts.find((a) => a.key === key) : undefined
  const chapter: SuggestedChapter | undefined =
    level === 'scenes' ? [...p.chapters, ...p.acts.flatMap((a) => a.chapters)].find((c) => c.key === key) : undefined
  if (!act && !chapter) return null
  if (act) act.chapters.push(...(stageParts(reply, 'chapters', done) as SuggestedChapter[]))
  if (chapter) chapter.scenes.push(...(stageParts(reply, 'scenes', done) as SuggestedScene[]))
  const lead = preambleOf(text)
  const body = outlineText(p)
  return lead ? `${lead}\n\n${body}` : body
}

/**
 * The outline being planned, as a stage is told it: every suggestion not discarded, with Adam's changes; those in the
 * story already end "(in the story)", and the one being planned inside "(plan this one)".
 */
export function planSoFar(text: string, decisions: Decisions, edits: Edits, target: string | null): string {
  const p = parseOutline(text, true)
  return outlineText(p, {
    edits,
    skip: (key) => decisions[key]?.status === 'discarded',
    note: (key) => (key === target ? ' (plan this one)' : decisions[key]?.status === 'kept' ? ' (in the story)' : '')
  })
}

/** The suggestions a stage would plan inside of: an act with no chapters yet, or a chapter with no scenes (none discarded count). */
export function canPlanInside(node: TreeNode, decisions: Decisions): boolean {
  if (node.kind === 'scene' || !node.complete) return false
  return !node.children.some((c) => decisions[c.key]?.status !== 'discarded')
}

/** The chapters a stage asks for under an act: the act's own rough number, else 3; at most 15. */
export const chaptersFor = (node: Pick<TreeNode, 'about'>, edit?: { about?: number }): number => Math.max(1, Math.min(15, edit?.about ?? node.about ?? 3))

/**
 * The tree with the stage still arriving under `key` marked: its last part (and what is inside that) not complete yet,
 * so it has the caret and no buttons.
 */
export function markArriving(tree: TreeNode[], key: string, before: number): TreeNode[] {
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) => {
      if (n.key === key) {
        const kids = n.children.map((c, i) => (i >= before && i === n.children.length - 1 ? notDone(c) : c))
        return { ...n, children: kids }
      }
      return n.children.length ? { ...n, children: walk(n.children) } : n
    })
  return walk(tree)
}

const notDone = (n: TreeNode): TreeNode => ({ ...n, complete: false, children: n.children.map(notDone) })

/** The suggestion being written while a stage arrives under `key`: its last part, the deepest of the last. */
export function arrivingKey(tree: TreeNode[], key: string): string | null {
  const find = (nodes: TreeNode[]): TreeNode | null => {
    for (const n of nodes) {
      if (n.key === key) return n
      const inner = find(n.children)
      if (inner) return inner
    }
    return null
  }
  let n = find(tree)
  if (!n?.children.length) return null
  while (n.children.length) n = n.children[n.children.length - 1]
  return n.key
}
