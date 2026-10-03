// What the History page and the Drafts tab say, worked out without React (so it is unit-tested):
// the list's days, the words, which version shows first, which unchanged paragraphs fold away in a
// comparison, and whether a version differs from the scene now.
import type { ID } from '@shared/types'
import { comparableDoc, type SnapshotInfo } from '@shared/contracts/history'
import type { Row } from './wordDiff'

export const wordsLabel = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`

const DAY_MS = 86_400_000

const startOfDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Today", "Yesterday", "Monday" (this past week), "28 September", or "28 September 2025" (another year). */
export function dayTitle(ms: number, nowMs: number): string {
  const days = Math.round((startOfDay(nowMs) - startOfDay(ms)) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const d = new Date(ms)
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear()
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "14:05" or "2:05 PM", as the computer shows times. */
export const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export interface DayGroup {
  title: string
  snapshots: SnapshotInfo[]
}

/** Snapshots (newest first) under the day each was taken. */
export function groupByDay(snapshots: SnapshotInfo[], nowMs: number): DayGroup[] {
  const groups: DayGroup[] = []
  for (const s of snapshots) {
    const title = dayTitle(Date.parse(s.createdAt), nowMs)
    const last = groups[groups.length - 1]
    if (last?.title === title) last.snapshots.push(s)
    else groups.push({ title, snapshots: [s] })
  }
  return groups
}

/** When a snapshot was taken, in a few words: "Today at 14:05", "Yesterday at 9:30", "28 September at 17:12". */
export const whenTaken = (iso: string, nowMs: number): string => `${dayTitle(Date.parse(iso), nowMs)} at ${timeOf(iso)}`

/** How an earlier version's length compares with the scene now: "120 words fewer than now". */
export function lengthAgainstNow(thenWords: number, nowWords: number): string {
  const d = thenWords - nowWords
  if (d === 0) return 'Same length as now'
  return `${wordsLabel(Math.abs(d))} ${d < 0 ? 'fewer' : 'more'} than now`
}

/** A row to show, or unchanged paragraphs folded away ("6 paragraphs the same"). */
export type Shown = { kind: 'row'; row: Row; key: string } | { kind: 'fold'; rows: Row[]; key: string }

/**
 * Folds long runs of unchanged paragraphs, keeping `context` of them beside each change, so the changes
 * are easy to find in a long scene. A fold always hides at least two paragraphs.
 */
export function foldSame(rows: Row[], context = 1): Shown[] {
  const out: Shown[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].kind !== 'same') {
      out.push({ kind: 'row', row: rows[i], key: `r${i}` })
      i++
      continue
    }
    let j = i
    while (j < rows.length && rows[j].kind === 'same') j++
    const keepBefore = i === 0 ? 0 : context
    const keepAfter = j === rows.length ? 0 : context
    if (j - i - keepBefore - keepAfter >= 2) {
      for (let k = i; k < i + keepBefore; k++) out.push({ kind: 'row', row: rows[k], key: `r${k}` })
      out.push({ kind: 'fold', rows: rows.slice(i + keepBefore, j - keepAfter), key: `f${i + keepBefore}` })
      for (let k = j - keepAfter; k < j; k++) out.push({ kind: 'row', row: rows[k], key: `r${k}` })
    } else {
      for (let k = i; k < j; k++) out.push({ kind: 'row', row: rows[k], key: `r${k}` })
    }
    i = j
  }
  return out
}

/**
 * How many paragraphs differ between the two sides. A paragraph written afresh beside another counts
 * once, and a paragraph whose words are all the same (only a line break moved) not at all.
 */
export function paragraphsChanged(rows: Row[]): number {
  let n = 0
  for (const r of rows) {
    if (r.kind === 'apart') n += Math.max(r.then.length, r.now.length)
    else if (r.kind === 'changed') n += r.then.some((p) => p.changed) || r.now.some((p) => p.changed) ? 1 : 0
    else if (r.kind !== 'same') n++
  }
  return n
}

/** A version of the scene: its document (null when only the text was known) and its text. */
export interface Version {
  doc: unknown
  text: string
}

/**
 * What the comparison says about a version against the scene now: the same (nothing to restore), the
 * same words in other formatting or line breaks (nothing marked, but Restore still brings it back), or
 * how many paragraphs differ.
 */
export type AgainstNow = { kind: 'same' } | { kind: 'format' } | { kind: 'differ'; paragraphs: number }

export function againstNow(rows: Row[], then: Version, now: Version): AgainstNow {
  const paragraphs = paragraphsChanged(rows)
  if (paragraphs > 0) return { kind: 'differ', paragraphs }
  // Formatting can only be told apart when both documents are known (history.db's sameAs agrees).
  const a = comparableDoc(then.doc)
  const b = comparableDoc(now.doc)
  return then.text === now.text && (a === null || b === null || a === b) ? { kind: 'same' } : { kind: 'format' }
}

/** The version the History page shows first: the newest that differs from the scene now (or the newest, if none does). */
export function firstToShow(h: { snapshots: SnapshotInfo[]; sameAsNow: ID[] }): ID | null {
  const same = new Set(h.sameAsNow)
  return (h.snapshots.find((s) => !same.has(s.id)) ?? h.snapshots[0])?.id ?? null
}
