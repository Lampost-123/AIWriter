// What the draft controls need from a scene's card, and what a draft should cost (review #16 and #38, 2026-10-21): one
// copy for Generate's controls (useGenerate) and Draft three (variants/StartPanel). Only the answer for the scene still
// open is kept: switching scenes quickly, a late answer for the scene left is dropped, so the old scene's length and plan
// never land in the new one's controls or its estimate.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Creativity, ID, ModelChoice } from '@shared/types'
import { AUTO_LENGTH, cardLength } from '@shared/defaults'
import { api } from '@/lib/api'
import { estimateDraftCost } from './format'

/** Numbers each request so only the latest one's answer counts. */
export function latestOnly(): { next: () => number; isLatest: (n: number) => boolean; drop: () => void } {
  let at = 0
  return {
    next: () => ++at,
    isLatest: (n) => n === at,
    drop: () => void at++
  }
}

export interface SceneCardInfo {
  /** The length the card asks for: a number, null for none, undefined until read. */
  cardWords: number | null | undefined
  /** Whether the card says anything about what happens (null until read). */
  cardPlanned: boolean | null
  /** Reads the card again (at most once in 5 seconds unless forced). */
  loadCard: (force?: boolean) => void
  /** Bumped at each read, so the estimate is worked out again. */
  rev: number
  /** The card may have changed (a draft ended): the next loadCard reads it whatever the time. */
  expire: () => void
}

const RELOAD_MS = 5000

export function useSceneCardInfo(sceneId: ID): SceneCardInfo {
  const [cardWords, setCardWords] = useState<number | null | undefined>(undefined)
  const [cardPlanned, setCardPlanned] = useState<boolean | null>(null)
  const [rev, setRev] = useState(0)
  const asks = useRef(latestOnly())
  const lastLoad = useRef(0)
  const loadCard = useCallback(
    (force = false) => {
      if (!force && Date.now() - lastLoad.current < RELOAD_MS) return
      lastLoad.current = Date.now()
      setRev((n) => n + 1)
      const ask = asks.current.next()
      api
        .getScene(sceneId)
        .then((s) => {
          if (!asks.current.isLatest(ask)) return
          const c = s.card
          setCardWords(cardLength(c))
          setCardPlanned(c.beats.some((b) => b.trim() !== '') || [c.goal, c.outcome, c.notes].some((t) => t.trim() !== ''))
        })
        .catch(() => undefined)
    },
    [sceneId]
  )
  useEffect(() => {
    setCardWords(undefined)
    setCardPlanned(null)
    lastLoad.current = 0
    loadCard(true)
    const current = asks.current
    return () => current.drop()
  }, [sceneId, loadCard])
  const expire = useCallback(() => void (lastLoad.current = 0), [])
  return { cardWords, cardPlanned, loadCard, rev, expire }
}

/**
 * What one draft of the scene should cost, for models with prices (null otherwise, or until the card is read): the
 * briefing as it would be sent, and the length (Auto at a typical scene's). Worked out a moment after the last change.
 */
export function useDraftEstimate(o: {
  sceneId: ID
  writer: ModelChoice | null
  cardWords: number | null | undefined
  targetWords: number | null
  direction: string
  creativity: Creativity
  /** Bumped when the card may have changed. */
  rev?: number
}): number | null {
  const { sceneId, writer, cardWords, targetWords, direction, creativity, rev = 0 } = o
  const [estimate, setEstimate] = useState<{ sceneId: ID; value: number | null } | null>(null)
  // Keyed on the values, not the settings object, which is replaced whenever any setting is saved.
  const promptPrice = writer?.promptPrice ?? null
  const completionPrice = writer?.completionPrice ?? null
  const writerKey = writer ? `${writer.providerId}/${writer.modelId}/${writer.contextLength ?? ''}` : null
  useEffect(() => {
    if (!writerKey || promptPrice == null || completionPrice == null || cardWords === undefined) {
      setEstimate(null)
      return
    }
    const prices = { promptPrice, completionPrice }
    let live = true
    const t = setTimeout(() => {
      api
        .previewContext(sceneId, { direction, targetWords, creativity })
        .then((p) => live && setEstimate({ sceneId, value: estimateDraftCost(p.budget.used, targetWords ?? AUTO_LENGTH.typical, prices) }))
        .catch(() => live && setEstimate(null))
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [sceneId, writerKey, promptPrice, completionPrice, cardWords, targetWords, direction, creativity, rev])
  return estimate?.sceneId === sceneId ? estimate.value : null
}
