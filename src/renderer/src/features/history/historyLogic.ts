// What the History page and the Drafts tab say, worked out without React (so it is unit-tested):
// the list's days, the words, and which unchanged paragraphs fold away in a comparison.
import type { SnapshotInfo } from '@shared/contracts/history'
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

/** How many paragraphs differ between the two sides. */
export const paragraphsChanged = (rows: Row[]): number => rows.filter((r) => r.kind !== 'same').length
