// "Polish after drafting" (Generate's draft options): the pure parts, so they are unit-tested. Whether it is
// on (Adam's last choice, remembered on this computer), what a draft costs with it, and where the draft is in
// the page: found when the draft ends, and found again when the polished version comes back, so the revision
// takes the place of the draft only while the draft is still exactly as it was written.

import type { Node as PMNode } from '@tiptap/pm/model'
import { countWords } from '@shared/defaults'
import { textOf } from '@/features/edits/text'

const POLISH_KEY = 'aiwrite.draft.polish'

/** Adam's last choice for "Polish after drafting": off until he turns it on. */
export function lastPolish(): boolean {
  try {
    return localStorage.getItem(POLISH_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberPolish(on: boolean): void {
  try {
    localStorage.setItem(POLISH_KEY, on ? '1' : '0')
  } catch {
    // Remembering it is only a convenience.
  }
}

/** A draft's estimated cost with the polish pass: the pass reads the draft and writes it again, so about twice. */
export const withPolish = (estimate: number, polish: boolean): number => (polish ? estimate * 2 : estimate)

/**
 * Whether a finished draft is there to polish: one meant to replace the scene's text counts only if it did
 * (when only a lead-in arrived, the old text is put back, and that is Adam's own writing, not the draft).
 */
export const polishable = (replaceMode: boolean, replaced: boolean): boolean => !replaceMode || replaced

/** Where a finished draft is in the page: from top-level block `index` to the end. */
export interface DraftPlace {
  /** The first top-level block of the draft (after the scene break put in before it, if any). */
  index: number
  /** How many top-level blocks the draft is. */
  blocks: number
  /** The draft as it stands, as the AI is sent it (*italics*, "* * *" for a scene break). */
  text: string
}

/** The top-level block a position (a block boundary) starts, counting from 0. */
export function blockIndexAt(doc: PMNode, pos: number): number {
  let at = 0
  let index = 0
  while (index < doc.childCount && at < pos) {
    at += doc.child(index).nodeSize
    index++
  }
  return index
}

/** The position just before top-level block `index`. */
function startOf(doc: PMNode, index: number): number {
  let at = 0
  for (let i = 0; i < index && i < doc.childCount; i++) at += doc.child(i).nodeSize
  return at
}

/**
 * Where the draft is once its stream has ended: `start` is the block the draft's stream began at (taken
 * before it ended, with blockIndexAt), `breakAdded` whether a scene break was put in before it. Null when
 * there are no words to polish.
 */
export function draftPlace(doc: PMNode, start: number, breakAdded: boolean): DraftPlace | null {
  let index = start
  if (breakAdded && index < doc.childCount && doc.child(index).type.name === 'horizontalRule') index++
  if (index >= doc.childCount) return null
  const text = textOf(doc, startOf(doc, index), doc.content.size).trim()
  if (!text) return null
  return { index, blocks: doc.childCount - index, text }
}

/**
 * The range of the draft in the page now, for the polished version to take its place: the start of its first
 * paragraph to the end of its last. 'changed' when its words are no longer exactly as they were written (Adam
 * edited them, or text was added after them); 'gone' when it can't be found or doesn't start and end in words.
 */
export function findDraft(doc: PMNode, place: DraftPlace): { from: number; to: number } | 'changed' | 'gone' {
  const index = doc.childCount - place.blocks
  if (index < 0) return 'gone'
  const start = startOf(doc, index)
  if (textOf(doc, start, doc.content.size).trim() !== place.text) return 'changed'
  const first = doc.child(index)
  const last = doc.child(doc.childCount - 1)
  if (!first.isTextblock || !last.isTextblock) return 'gone'
  return { from: start + 1, to: doc.content.size - 1 }
}

/** A polished version shorter than this share of the draft's words is taken to have lost part of the scene. */
export const POLISH_MIN_SHARE = 0.6

/** A line that starts the model's own notes after the scene: "Changes made:", "**Notes:**", "Summary of changes". */
const NOTES_LINE =
  /^[ \t]*(?:[-=*_]{3,}[ \t]*\n[ \t]*)?(?:#{1,4}[ \t]*)?(?:\*\*|__)?(?:changes(?: made)?|notes?|edits?(?: made)?|revisions?(?: made)?|summary of (?:changes|edits)|what (?:I|was) changed|key changes|editor['’]?s notes?)(?:\*\*|__)?[ \t]*(?::(?:\*\*|__)?[^\n]*)?$/im

/**
 * The polished scene to offer in place of the draft, from the polish pass's reply (already without a lead-in:
 * cleanReply): a trailing block of notes about the changes is taken off. Null, with the reason, when it
 * can't stand in for the draft: a refusal, or far shorter than the draft (part of the scene is missing).
 */
export function polishedScene(reply: string, draft: string, isRefusal: (text: string) => boolean): { text: string } | { problem: 'refused' | 'short' | 'empty' } {
  let text = reply.replace(/\r\n?/g, '\n').trim()
  // Notes after the scene start on a line of their own, after a blank line (or a rule).
  const notes = /\n[ \t]*\n/.exec(text) ? findNotes(text) : -1
  if (notes > 0) text = text.slice(0, notes).replace(/\n[ \t]*[-=*_]{3,}[ \t]*$/, '').trim()
  if (!text) return { problem: 'empty' }
  if (isRefusal(text)) return { problem: 'refused' }
  if (countWords(text) < countWords(draft) * POLISH_MIN_SHARE) return { problem: 'short' }
  return { text }
}

/** Where the notes block starts (a position in `text`), or -1. Only a heading line after a blank line counts. */
function findNotes(text: string): number {
  const re = new RegExp(NOTES_LINE.source, 'gim')
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(0, m.index)
    if (m.index > 0 && /\n[ \t]*\n[ \t]*$/.test(before)) return m.index
  }
  return -1
}
