// The steps a draft is on before its first word, as the main process says them ('draft:step', main ai/steps.ts), and the
// calm status line made from them (waitWords.ts): "Catching up the memory: scene 3 of 5", "Planning the scene…",
// "Looking up 3 things…", "Writing…". Generate's controls and the desk's AI dock both show it.
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { DraftStep } from '@shared/contracts/calm'
import type { ID } from '@shared/types'
import { onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { usePlanReview } from '@/features/planReview/store'
import { calmStep, CALM_MS, draftWaitWords, type Calm } from './waitWords'

interface Steps {
  /** Each scene's latest step, while a draft of it gets ready, and when it was heard. */
  steps: Record<ID, DraftStep & { at: number }>
}

export const useDraftSteps = create<Steps>(() => ({ steps: {} }))

let listening = false

/** Hears the drafts' steps (once), for as long as the window is open. */
export function listenForDraftSteps(): void {
  if (listening || typeof window === 'undefined' || !window.aiwrite) return
  listening = true
  onEvent('draft:step', (s) => useDraftSteps.setState({ steps: { ...useDraftSteps.getState().steps, [s.sceneId]: { ...s, at: Date.now() } } }))
}

/** The scene's draft got going (or ended): its steps are forgotten, so the next draft starts afresh. */
export function forgetSteps(sceneId: ID): void {
  const steps = { ...useDraftSteps.getState().steps }
  if (!(sceneId in steps)) return
  delete steps[sceneId]
  useDraftSteps.setState({ steps })
}

/** A line of words that changes calmly: a new one shows once it has lasted CALM_MS (calmStep). */
export function useCalmLine(text: string): string {
  const calm = useRef<Calm | null>(null)
  const [, redraw] = useState(0)
  calm.current = calmStep(calm.current, text, Date.now())
  const waiting = calm.current.next
  useEffect(() => {
    if (!waiting) return
    const t = setTimeout(() => redraw((n) => n + 1), Math.max(0, CALM_MS - (Date.now() - waiting.since)) + 10)
    return () => clearTimeout(t)
  }, [waiting?.text, waiting?.since])
  return calm.current.shown
}

/**
 * What the status line says while the scene's draft gets ready (`starting`), calmly; null otherwise. The steps are
 * forgotten once it is no longer getting ready, so the next draft starts from "Getting ready…".
 */
export function useDraftWait(sceneId: ID, starting: boolean): { words: string; short: string; title: string } | null {
  listenForDraftSteps()
  const heard = useDraftSteps((s) => s.steps[sceneId] ?? null)
  const memory = useApp((s) => s.memoryStatus)
  // Only steps heard since this draft began getting ready (one heard late from the draft before never counts).
  const since = useRef<number | null>(null)
  if (starting && since.current === null) since.current = Date.now() - 500
  if (!starting) since.current = null
  const step = heard && since.current !== null && heard.at >= since.current ? heard : null
  useEffect(() => {
    if (!starting) forgetSteps(sceneId)
  }, [starting, sceneId])
  const review = usePlanReview((s) => s.waiting.some((r) => r.sceneId === sceneId))
  const now = draftWaitWords(starting ? step : null, memory, sceneId, { review: starting && review })
  const words = useCalmLine(starting ? now.words : '')
  const short = useCalmLine(starting ? now.short : '')
  if (!starting) return null
  // The hover goes with the words showing.
  const title = words === now.words ? now.title : draftWaitWords(null, memory, sceneId).title
  return { words: words || now.words, short: short || now.short, title }
}
