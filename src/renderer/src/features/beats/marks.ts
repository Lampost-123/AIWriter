// Beat markers (2026-10-08): where each beat of the scene's latest beat by beat session is on the page, worked
// out from the paragraph ids each beat wrote (kept with the scene: SceneBeatMarks, src/main/beats/marks.ts), and
// which version of each beat shows. Pure, so it is unit-tested (marks.test.ts).
//
// - A beat's paragraphs keep their ids while Adam edits them, and through undo and redo, so its markers follow it.
//   Splitting one of them in two (Enter in the middle) gives the second half a new id, which joins the beat; any
//   other new paragraph (typed, pasted) is Adam's own and stays out of it.
// - Each version of a beat that went in keeps a fingerprint of its words (beatSig). The version showing is the one
//   whose fingerprint the beat's words have now (undo puts an earlier version back, and with it its record); when
//   none does (Adam has edited them), the newest.
// - A beat written before an earlier beat changed (that beat written again since) is "written before beat N
//   changed", until Adam writes it again or keeps it as it is.

import type { Node as PMNode } from '@tiptap/pm/model'
import type { BeatMark, BeatVersion, SceneBeatMarks } from '@shared/contracts/beats'
import type { ID } from '@shared/types'
import { beatsOnPage, filledParagraphs, type BeatMode, type BeatParagraphs } from './sessionLogic'

export type { BeatMark, BeatVersion, SceneBeatMarks }

/** A short fingerprint of some words: their length and an FNV-1a hash. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`
}

/** The words of a beat's paragraphs on the page, in order. */
export function beatText(doc: PMNode, pids: readonly string[]): string {
  const mine = new Set(pids)
  return filledParagraphs(doc)
    .filter((p) => mine.has(p.pid))
    .map((p) => p.node.textContent.trim())
    .join('\n\n')
}

/** The fingerprint of a beat's words as the page shows them ('' when none of them is there). */
export const beatSig = (doc: PMNode, pids: readonly string[]): string => {
  const t = beatText(doc, pids)
  return t ? fingerprint(t) : ''
}

/** A new session's marks, with no beats yet. */
export const newMarks = (sceneId: ID, sessionId: ID, of: number, mode: BeatMode): SceneBeatMarks => ({
  sceneId,
  sessionId,
  of,
  mode,
  beats: []
})

/** The marks as the session's paragraphs (beat number to paragraph ids), as sessionLogic.ts reads them. */
export function paragraphsOf(marks: SceneBeatMarks | null): BeatParagraphs {
  const out: BeatParagraphs = {}
  for (const b of marks?.beats ?? []) out[b.index] = b.pids
  return out
}

export const beatOf = (marks: SceneBeatMarks | null, index: number): BeatMark | null =>
  marks?.beats.find((b) => b.index === index) ?? null

function withBeat(marks: SceneBeatMarks, index: number, change: (b: BeatMark) => BeatMark): SceneBeatMarks {
  const had = beatOf(marks, index)
  const next = change(had ?? { index, pids: [], versions: [] })
  if (next === had) return marks
  const beats = had ? marks.beats.map((b) => (b.index === index ? next : b)) : [...marks.beats, next].sort((a, b) => a.index - b.index)
  return { ...marks, beats }
}

/** Adds paragraphs a beat wrote (in order, every version's). Returns the same object when nothing is new. */
export function withPids(marks: SceneBeatMarks, index: number, pids: readonly string[]): SceneBeatMarks {
  return withBeat(marks, index, (b) => {
    const fresh = pids.filter((p) => !b.pids.includes(p))
    return fresh.length ? { ...b, pids: [...b.pids, ...fresh] } : b
  })
}

/** A version of a beat went into the page (its record, when, and its words' fingerprint then). */
export function withVersion(marks: SceneBeatMarks, index: number, version: BeatVersion): SceneBeatMarks {
  return withBeat(marks, index, (b) => {
    if (b.versions.some((v) => v.recordId === version.recordId && v.sig === version.sig)) return b
    // The same record again (its words came back with Ctrl+Y, say): its fingerprint is brought up to date.
    const others = b.versions.filter((v) => v.recordId !== version.recordId)
    return { ...b, versions: [...others, version] }
  })
}

/**
 * Check and repair mended slips in a version's words as they landed: its fingerprint becomes the mended words'.
 * Returns the same object when no beat has that record.
 */
export function withMended(marks: SceneBeatMarks, recordId: ID, doc: PMNode): SceneBeatMarks {
  const beat = marks.beats.find((b) => b.versions.some((v) => v.recordId === recordId))
  if (!beat) return marks
  const sig = beatSig(doc, beat.pids)
  return withBeat(marks, beat.index, (b) => ({ ...b, versions: b.versions.map((v) => (v.recordId === recordId ? { ...v, sig } : v)) }))
}

/** Adam keeps a beat as it is although a beat before it changed: its note goes. */
export const keptAsIs = (marks: SceneBeatMarks, index: number, at: number): SceneBeatMarks =>
  withBeat(marks, index, (b) => ({ ...b, keptAt: at }))

/** The version of a beat showing on the page: the one its words match, else the newest. Null with none. */
export function currentVersion(doc: PMNode, beat: BeatMark): BeatVersion | null {
  if (!beat.versions.length) return null
  const sig = beatSig(doc, beat.pids)
  for (let i = beat.versions.length - 1; i >= 0; i--) if (beat.versions[i].sig === sig) return beat.versions[i]
  return beat.versions[beat.versions.length - 1]
}

/** A beat as it shows on the page. */
export interface BeatOnPage {
  index: number
  /** Its paragraphs with words on the page, in order. */
  pids: string[]
  /** Where its first paragraph begins. */
  pos: number
  /** The record of the version showing (null for a beat with no record kept). */
  recordId: ID | null
  /** The earlier beat that changed after this one was written (its note), or null. */
  staleBy: number | null
}

/**
 * The beats with words on the page, in order of their number, with the version showing and their notes. A
 * paragraph belongs to the first beat that claims it.
 */
export function beatsShown(doc: PMNode, marks: SceneBeatMarks | null): BeatOnPage[] {
  if (!marks?.beats.length) return []
  const owner = new Map<string, number>()
  for (const b of marks.beats) for (const pid of b.pids) if (!owner.has(pid)) owner.set(pid, b.index)
  const found = new Map<number, { pids: string[]; pos: number }>()
  for (const p of filledParagraphs(doc)) {
    const i = owner.get(p.pid)
    if (i == null) continue
    const f = found.get(i)
    if (f) f.pids.push(p.pid)
    else found.set(i, { pids: [p.pid], pos: p.pos })
  }
  const shown = marks.beats
    .filter((b) => found.has(b.index))
    .map((b) => ({ beat: b, version: currentVersion(doc, b), ...found.get(b.index)! }))
  return shown.map((x) => {
    // The earliest beat before it whose version showing went in after this one's (and after Adam kept this one).
    const since = Math.max(x.version?.at ?? Infinity, x.beat.keptAt ?? 0)
    const by = shown.find((y) => y.beat.index < x.beat.index && y.version && y.version.at > since)
    return { index: x.beat.index, pids: x.pids, pos: x.pos, recordId: x.version?.recordId ?? null, staleBy: by?.beat.index ?? null }
  })
}

/**
 * After a change to the page: a paragraph of a beat split in two (Enter in its middle) gives the second half a
 * new id, which joins the beat. Told so by the words: the paragraph before the new one had, before the change,
 * exactly the words the two have now. Any other new paragraph is Adam's own. Returns the same object when no
 * beat gained a paragraph.
 */
export function adoptSplits(before: PMNode, doc: PMNode, marks: SceneBeatMarks): SceneBeatMarks {
  const owner = new Map<string, number>()
  for (const b of marks.beats) for (const pid of b.pids) if (!owner.has(pid)) owner.set(pid, b.index)
  const was = new Map(filledParagraphs(before).map((p) => [p.pid, p.node.textContent]))
  const now = filledParagraphs(doc)
  const squash = (t: string): string => t.replace(/\s+/g, '')
  let out = marks
  for (let k = 1; k < now.length; k++) {
    const p = now[k]
    if (owner.has(p.pid) || was.has(p.pid)) continue
    const prev = now[k - 1]
    const beat = owner.get(prev.pid)
    const old = was.get(prev.pid)
    if (beat == null || old == null) continue
    if (squash(old) !== squash(prev.node.textContent + p.node.textContent)) continue
    owner.set(p.pid, beat)
    out = withBeat(out, beat, (b) => {
      const at = b.pids.indexOf(prev.pid)
      return { ...b, pids: [...b.pids.slice(0, at + 1), p.pid, ...b.pids.slice(at + 1)] }
    })
  }
  return out
}

/** The beats after `index` written before a beat before them changed (their notes say so), in order. */
export const writtenBefore = (shown: readonly BeatOnPage[], index: number): number[] =>
  shown.filter((b) => b.index > index && b.staleBy != null).map((b) => b.index)

/** Where a beat by beat session left off, as its kept marks and the page say: what carrying it on starts from. */
export interface ResumePoint {
  /** How many beats are on the page (the highest with any of its words there). */
  written: number
  /** How many beats the scene card has now. */
  of: number
  paragraphs: BeatParagraphs
  /** Which record wrote each paragraph: each beat's version showing. */
  owners: Record<string, ID>
  /** The record of the last beat on the page (the version showing), or null with none kept. */
  last: ID | null
}

/**
 * Where the scene's kept beat by beat session can carry on from: null unless at least one of its beats is on the
 * page and fewer than the `of` beats on the scene card are (so there is a next beat to write).
 */
export function resumePoint(doc: PMNode, marks: SceneBeatMarks | null, of: number): ResumePoint | null {
  if (!marks?.beats.length || of < 1) return null
  const paragraphs = paragraphsOf(marks)
  const written = beatsOnPage(doc, paragraphs)
  if (written < 1 || written >= of) return null
  const owners: Record<string, ID> = {}
  let last: ID | null = null
  for (const b of marks.beats) {
    const v = currentVersion(doc, b)
    if (!v) continue
    for (const pid of b.pids) owners[pid] = v.recordId
    if (b.index === written) last = v.recordId
  }
  return { written, of, paragraphs, owners, last }
}
