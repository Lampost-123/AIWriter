// Write the whole chapter in the window (contracts/chapterWriter.ts): which chapter the start dialog asks about, the
// run going now (the top bar shows it, with Stop), the chapter plan waiting for Adam before anything is written
// (ChapterPlanReview.tsx: Write, Change the plan, Cancel), the page holding the scenes it works on, and the message when
// it ends (Show opens the report on the chapter card; Undo puts the chapter back). Listens once, from the dialog mounted
// in the workspace (ChapterWriterDialog.tsx).

import { create } from 'zustand'
import type { ChapterPlanAnswer, ChapterWriterProgress, ChapterWriterReport } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { endWords } from './chapterWriterLogic'
import { setHeld, showRunChange } from './hold'

interface ChapterWriterState {
  /** The chapter the start dialog asks about; null when it is closed. */
  ask: ID | null
  /** The run going now. */
  progress: ChapterWriterProgress | null
  /** Bumped when a chapter's report changes, so the report on its card reloads. */
  reportRev: number
  /** The chapter plan's window shows (while the run waits for Adam over it; closed, the top bar opens it again). */
  planOpen: boolean
}

export const useChapterWriter = create<ChapterWriterState>(() => ({ ask: null, progress: null, reportRev: 0, planOpen: false }))

export const openChapterWriter = (chapterId: ID): void => useChapterWriter.setState({ ask: chapterId })
export const closeChapterWriter = (): void => useChapterWriter.setState({ ask: null })

const bumpReport = (): void => useChapterWriter.setState((s) => ({ reportRev: s.reportRev + 1 }))

function setProgress(p: ChapterWriterProgress | null): void {
  const was = useChapterWriter.getState().progress
  // The plan opens by itself once it is ready, and closes once writing starts.
  const review = p?.stage === 'review'
  const planOpen = review ? (was?.stage === 'review' && was.runId === p.runId ? useChapterWriter.getState().planOpen : true) : false
  useChapterWriter.setState({ progress: p, planOpen })
  setHeld(p?.sceneIds ?? [])
}

/** Shows the chapter plan waiting for Adam again (closed with Escape, say). */
export const openChapterPlan = (): void => useChapterWriter.setState((s) => ({ planOpen: s.progress?.stage === 'review' }))
/** Hides the chapter plan; the run goes on waiting for it (the top bar opens it again). */
export const hideChapterPlan = (): void => useChapterWriter.setState({ planOpen: false })

/** Writes the chapter to the plan, with any part Adam changed. Throws (plain words) when the run isn't waiting any more. */
export async function writeToChapterPlan(changes: Pick<ChapterPlanAnswer, 'scenes' | 'overview'>): Promise<void> {
  const p = useChapterWriter.getState().progress
  if (!p || p.stage !== 'review') return
  await api.answerChapterPlan({ runId: p.runId, ...changes })
  useChapterWriter.setState({ planOpen: false })
}

/** Starts the run (the page saved first). Throws (plain words) when it can't start. */
export async function startChapterWriter(chapterId: ID): Promise<void> {
  await flushAll()
  const runId = globalThis.crypto.randomUUID()
  await api.startChapterWriter({ runId, chapterId })
  const now = await api.chapterWriterNow()
  if (now?.runId === runId) setProgress(now)
  bumpReport()
}

export async function stopChapterWriter(): Promise<void> {
  const p = useChapterWriter.getState().progress
  if (!p) return
  try {
    await api.stopChapterWriter(p.runId)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
}

/** Shows the chapter's report: its card in the side panel, where the report sits under the card. */
export function showReport(chapterId: ID): void {
  const app = useApp.getState()
  if (app.view.kind !== 'write') app.navigate({ kind: 'write' })
  app.openChapterCard(chapterId)
  // The report sits under the card: brought into view once the card has drawn (a second at most).
  let tries = 0
  const reveal = (): void => {
    const el = document.querySelector('[data-testid="chapter-writer-report"]')
    if (el) el.scrollIntoView({ block: 'start' })
    else if (++tries < 60) requestAnimationFrame(reveal)
  }
  requestAnimationFrame(reveal)
}

/** Puts the chapter back as it was before the latest run, saying so. */
export async function undoChapterWriter(chapterId: ID): Promise<void> {
  try {
    const { restored } = await api.undoChapterWriter(chapterId)
    bumpReport()
    toast(restored ? `Put back ${restored === 1 ? 'one scene' : `${restored} scenes`} as ${restored === 1 ? 'it was' : 'they were'} before the AI wrote the chapter.` : 'The chapter was already as it was before.')
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
}

/** The chapter's title as the messages name it. */
async function titleOf(chapterId: ID): Promise<string> {
  try {
    // "Chapter 3", without its title: the messages read better short.
    return (await api.chapterWriterPlan(chapterId)).title.split(':')[0]
  } catch {
    return 'The chapter'
  }
}

let listening = false

/** Listens for the run's events (once) and picks up a run already going. */
export function listenChapterWriter(): void {
  if (listening) return
  listening = true
  onEvent('chapterWriter:progress', (p) => setProgress(p))
  onEvent('chapterWriter:sceneChanged', (e) => showRunChange(e.sceneId, e.doc, e.text))
  onEvent('chapterWriter:done', (e) => {
    setProgress(null)
    bumpReport()
    void announce(e.chapterId, e.report)
  })
  void api
    .chapterWriterNow()
    .then((p) => p && setProgress(p))
    .catch(() => undefined)
}

async function announce(chapterId: ID, report: ChapterWriterReport): Promise<void> {
  // Cancelled at the plan (or stopped while planning): nothing was written, so there is nothing to show or undo.
  if (report.status === 'cancelled') return void toast(report.message || 'Cancelled: nothing in the chapter changed.')
  const title = await titleOf(chapterId)
  const tone = report.status === 'error' || report.status === 'limit' ? 'danger' : 'neutral'
  toast(endWords(report, title), {
    tone,
    action: { label: 'Undo', run: () => void undoChapterWriter(chapterId) },
    secondary: { label: 'Show', run: () => showReport(chapterId) }
  })
}
