// Write the whole chapter in the window (contracts/chapterWriter.ts): the run going now (the top bar shows it, with Stop),
// the chapter plan waiting for Adam before anything is written (shown inline at its chapter in Build with AI's story
// line, ChapterPlanReview.tsx: Write the chapter, Change the plan, Cancel), the page holding the scenes it works on, and
// the message when it ends (Show opens the report on the chapter card; Undo puts the chapter back). Every way in (the
// binder's chapter menu, the palette, a chapter card's report) opens Build with AI at that chapter, Write this chapter
// open in its row (2026-10-20: the start dialog is that row now). Listens once, from the workspace (App.tsx).

import { create } from 'zustand'
import type { ChapterPlanAnswer, ChapterWriterProgress, ChapterWriterReport } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { endWords, undoWords } from './chapterWriterLogic'
import { setHeld, showRunChange } from './hold'
import { forgetSteps } from '@/features/waits/useDraftWait'

interface ChapterWriterState {
  /** The run going now. */
  progress: ChapterWriterProgress | null
  /** Bumped when a chapter's report changes, so the report on its card reloads. */
  reportRev: number
  /** How the latest run ended (the top bar's progress card, left open, says so). */
  last: { chapterId: ID; report: ChapterWriterReport } | null
}

export const useChapterWriter = create<ChapterWriterState>(() => ({ progress: null, reportRev: 0, last: null }))

/** The story a chapter is in: the binder's when it shows it, else the story open. */
function storyOfChapter(chapterId: ID): ID | null {
  const o = useOutlineStore.getState().outline
  if (o?.chapters.some((c) => c.id === chapterId)) return o.story.id
  return useApp.getState().storyId
}

/**
 * "Write this chapter with AI" from anywhere: Build with AI at that chapter, Write this chapter open in its row (what the
 * chapter's scenes are ready for, then its plan, then how it goes). `known`: the chapter's story, when the caller knows it.
 */
export function openChapterWriter(chapterId: ID, known?: ID): void {
  const storyId = known || storyOfChapter(chapterId)
  if (!storyId) return
  useApp.getState().navigate({ kind: 'planHub', storyId, section: 'line', chapterId, open: 'write' })
}

const bumpReport = (): void => useChapterWriter.setState((s) => ({ reportRev: s.reportRev + 1 }))

function setProgress(p: ChapterWriterProgress | null): void {
  const was = useChapterWriter.getState().progress
  // A scene's draft begins: the steps heard before it (its earlier draft's, say) are forgotten.
  if (p?.sceneId && p.doing === 'draft' && (was?.sceneId !== p.sceneId || was?.doing !== 'draft')) forgetSteps(p.sceneId)
  useChapterWriter.setState({ progress: p })
  setHeld(p?.sceneIds ?? [])
  // Past the plan: the chapter may have its new name now (saved before anything is written), so the binder, Build with
  // AI and the page head read the outline again.
  if (was?.stage === 'review' && p?.runId === was.runId && p.stage !== 'review') useApp.getState().bumpOutline()
}

/** The chapter plan waiting for Adam (the top bar's "The chapter plan is ready for you"): its chapter in Build with AI. */
export function openChapterPlan(): void {
  const p = useChapterWriter.getState().progress
  // In the run's own story: the binder may show another one (2026-10-21: the plan was looked for there, and never found).
  if (p) openChapterWriter(p.chapterId, p.storyId)
}

/** Writes the chapter to the plan, with any part Adam changed. Throws (plain words) when the run isn't waiting any more. */
export async function writeToChapterPlan(changes: Pick<ChapterPlanAnswer, 'scenes' | 'overview' | 'wants' | 'against' | 'turn' | 'title'>): Promise<void> {
  const p = useChapterWriter.getState().progress
  if (!p || p.stage !== 'review') return
  await api.answerChapterPlan({ runId: p.runId, ...changes })
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
    const { restored, renamed } = await api.undoChapterWriter(chapterId)
    bumpReport()
    if (renamed) useApp.getState().bumpOutline()
    toast(undoWords(restored, !!renamed))
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
    useChapterWriter.setState({ last: { chapterId: e.chapterId, report: e.report } })
    setProgress(null)
    bumpReport()
    if (e.report.named) useApp.getState().bumpOutline()
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
