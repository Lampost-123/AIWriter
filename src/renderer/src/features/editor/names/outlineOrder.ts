// What a scene's names need from the open story's outline: the order of its chapters and scenes,
// which numbers the places ("Book 1, Ch 2, Sc 3") and decides what came before each scene. Word
// counts, statuses and titles change with nearly every pause in the writing and don't matter here,
// so they are left out. Pure, so it is unit-tested.
import type { Outline } from '@shared/types'

/** Worked out once for each outline (the names' revision is read on every change to the stores). */
const orderOf = new WeakMap<Outline, string>()

/** The outline's chapters and scenes in order, as a string that changes only when that order does. */
export function outlineOrder(outline: Outline | null): string {
  if (!outline) return ''
  let order = orderOf.get(outline)
  if (order === undefined) {
    const scenes = outline.scenes.map((s) => `${s.chapterId}/${s.id}`).join(',')
    order = `${outline.story.id}|${outline.chapters.map((c) => c.id).join(',')}|${scenes}`
    orderOf.set(outline, order)
  }
  return order
}
