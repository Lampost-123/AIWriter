// Beat by beat's view of the page (milestone 4): which beats are on it, the text the next beat carries
// on from, and taking a beat out to write it again. Each beat remembers the ids of the paragraphs it
// wrote (every paragraph keeps its id while Adam edits it, and through undo and redo), so the page
// itself says how far the session has got: Ctrl+Z on a beat takes the session back a beat, and
// Ctrl+Shift+Z brings it forward again. Pure, so it is unit-tested (sessionLogic.test.ts).

import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { closeHistory, undoDepth } from '@tiptap/pm/history'
import { sceneText } from '@/features/editor/streamDoc'
import { PID_TYPES } from '@/features/editor/paragraphIds'

/** Where the session's beats go: they are the whole scene (an empty page, or Replace it), or below a scene break (Add below). */
export type BeatMode = 'whole' | 'below'

/** The paragraphs each beat wrote, by beat number (from 1): every version of it, so undoing a rewrite brings the beat back. */
export type BeatParagraphs = Record<number, string[]>

/** Adam's note for a beat is kept to this many characters (as src/main/beats/instructions.ts keeps it). */
export const MAX_NOTE_CHARS = 2000

/** The scene card's beats as the briefing numbers them: blank ones left out (as src/main/beats/instructions.ts does). */
export const cardBeats = (beats: readonly string[]): string[] => beats.map((b) => b.trim()).filter(Boolean)

const pidOf = (node: PMNode): string | null => (typeof node.attrs.pid === 'string' && node.attrs.pid ? node.attrs.pid : null)

/** Every paragraph with words in it, wherever it is (a quoted passage too), with its id and position, in order. */
export function filledParagraphs(doc: PMNode): { pid: string; pos: number; node: PMNode }[] {
  const out: { pid: string; pos: number; node: PMNode }[] = []
  doc.descendants((node, pos) => {
    if (PID_TYPES.includes(node.type.name)) {
      const pid = pidOf(node)
      if (pid && node.textContent.trim()) out.push({ pid, pos, node })
      return false
    }
    return !node.isTextblock
  })
  return out
}

/** The ids of the paragraphs with words at or after `from`: what a beat being written has put on the page. */
export const pidsFrom = (doc: PMNode, from: number): string[] => filledParagraphs(doc).flatMap((p) => (p.pos >= from ? [p.pid] : []))

/** Adds a beat's paragraphs to what it is known to have written. Returns the same object when nothing is new. */
export function withParagraphs(all: BeatParagraphs, beat: number, pids: string[]): BeatParagraphs {
  const had = all[beat] ?? []
  const fresh = pids.filter((id) => !had.includes(id))
  return fresh.length ? { ...all, [beat]: [...had, ...fresh] } : all
}

/** Notes the record that wrote these paragraphs. Returns the same object when nothing is new. */
export function withOwner(owners: Record<string, string>, pids: string[], record: string): Record<string, string> {
  const fresh = pids.filter((id) => owners[id] !== record)
  return fresh.length ? { ...owners, ...Object.fromEntries(fresh.map((id) => [id, record])) } : owners
}

/** The record whose words are the last of these paragraphs on the page (the version of a beat showing), or null. */
export function recordOf(doc: PMNode, pids: string[], owners: Record<string, string>): string | null {
  const mine = new Set(pids)
  let found: string | null = null
  for (const p of filledParagraphs(doc)) if (mine.has(p.pid) && owners[p.pid]) found = owners[p.pid]
  return found
}

/** Where the first of these paragraphs on the page begins (a beat's start), or null when none is there. */
export function startOf(doc: PMNode, pids: string[]): number | null {
  const mine = new Set(pids)
  return filledParagraphs(doc).find((p) => mine.has(p.pid))?.pos ?? null
}

/** True when the last paragraph with words on the page is one of these: nothing comes after the beat they are. */
export function endsPage(doc: PMNode, pids: string[]): boolean {
  const last = filledParagraphs(doc).at(-1)
  return !!last && pids.includes(last.pid)
}

/**
 * True when the scene so far that beat `index` carries on from ends with the beat before it, and not
 * with other words after that beat (Adam's own). `leaveOut`: a beat being written again, whose
 * paragraphs are about to go.
 */
export function endsWithBeat(doc: PMNode, beats: BeatParagraphs, index: number, leaveOut?: number): boolean {
  const skip = new Set(leaveOut ? (beats[leaveOut] ?? []) : [])
  const last = filledParagraphs(doc)
    .filter((p) => !skip.has(p.pid))
    .at(-1)
  return !!last && (beats[index - 1] ?? []).includes(last.pid)
}

/** The page as a beat left it: how many undo steps it had, and its text. */
export interface PageMark {
  depth: number
  doc: PMNode
}

export const markPage = (state: EditorState): PageMark => ({ depth: undoDepth(state), doc: state.doc })

/**
 * True when the page is as a beat left it (nothing changed since, or only undone and redone back to
 * it), so the beat is still the newest undo step and one undo takes exactly it out.
 */
export const unchangedSince = (state: EditorState, mark: PageMark | null | undefined): boolean =>
  !!mark && undoDepth(state) === mark.depth && state.doc.eq(mark.doc)

/** How many beats are on the page: the highest beat with any of its words still there (0: none). */
export function beatsOnPage(doc: PMNode, beats: BeatParagraphs): number {
  const on = new Set(filledParagraphs(doc).map((p) => p.pid))
  let top = 0
  for (const [k, pids] of Object.entries(beats)) {
    const n = Number(k)
    if (n > top && pids.some((id) => on.has(id))) top = n
  }
  return top
}

/** The beat to write next, or null once every beat on the scene card is on the page. */
export const nextBeat = (written: number, of: number): number | null => (written < of ? written + 1 : null)

/**
 * The scene so far that a beat carries on from, as plain text: all the scene's text (mode 'whole'), or
 * what is below the scene break the first beat went under, from the first paragraph a beat wrote
 * ('below'). `leaveOut`: a beat being written again, whose paragraphs are about to go.
 */
export function soFarText(doc: PMNode, mode: BeatMode, beats: BeatParagraphs, leaveOut?: number): string {
  const mine = new Set(Object.values(beats).flat())
  const start = mode === 'whole' ? 0 : (filledParagraphs(doc).find((p) => mine.has(p.pid))?.pos ?? null)
  if (start == null) return ''
  const skip = new Set(leaveOut ? (beats[leaveOut] ?? []) : [])
  const kept: PMNode[] = []
  doc.forEach((node, pos) => {
    if (pos + node.nodeSize <= start) return
    if (skip.has(pidOf(node) ?? '')) return
    kept.push(node)
  })
  return kept.length ? sceneText(doc.type.create(null, kept)) : ''
}

/** True when a beat's paragraphs are all the words on the page, so writing it again takes the page's place (as Replace it does). */
export function isWholePage(doc: PMNode, pids: string[]): boolean {
  const filled = filledParagraphs(doc)
  const mine = new Set(pids)
  return filled.length > 0 && filled.every((p) => mine.has(p.pid))
}

/**
 * Takes a beat's paragraphs out of the page, as one step of its own (Ctrl+Z brings them back), to write
 * the beat again in their place when Adam has changed the page since it was written (so it can't simply
 * be undone). Null when none of them are on the page.
 */
export function removeParagraphs(state: EditorState, pids: string[]): Transaction | null {
  const mine = new Set(pids)
  const ranges: { from: number; to: number }[] = []
  state.doc.descendants((node, pos) => {
    if (PID_TYPES.includes(node.type.name)) {
      if (mine.has(pidOf(node) ?? '')) ranges.push({ from: pos, to: pos + node.nodeSize })
      return false
    }
    return !node.isTextblock
  })
  if (!ranges.length) return null
  const tr = state.tr
  // From the end, so the positions before each one stay as they were.
  for (const r of ranges.reverse()) tr.deleteRange(r.from, r.to)
  return closeHistory(tr)
}
