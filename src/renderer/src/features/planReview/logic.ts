// Show me the plan first: the pure parts of the review (ScenePlanReview.tsx), unit-tested.
import type { ScenePlanParts } from '@shared/contracts/planReview'

/** The plan's boxes while Adam changes them: each beat its own box, the lists a line each. */
export interface Draft {
  wants: string
  against: string
  turn: string
  beats: string[]
  whoWhere: string
  changes: string
  closing: string
}

/** The lines of a box, empty ones left out (a list's "- " or "1. " too). */
export const splitLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)

/** A card check note as Adam reads it: "Before writing, note: Mara died…" is "Mara died…". */
export const noteText = (note: string): string => {
  const t = note.replace(/^Before writing, note:\s*/i, '').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x.replace(/\s+/g, ' ').trim() === b[i].replace(/\s+/g, ' ').trim())

/** True when Adam's parts say anything other than the plan as made. */
export function partsChanged(plan: ScenePlanParts, parts: ScenePlanParts): boolean {
  return !(
    same([plan.wants, plan.against, plan.turn, plan.closing], [parts.wants, parts.against, parts.turn, parts.closing]) &&
    same(plan.beats, parts.beats) &&
    same(plan.whoWhere, parts.whoWhere) &&
    same(plan.changes, parts.changes)
  )
}
