// The briefing a draft of this scene would get, kept up to date quietly as Adam works: when the
// scene card, his pins and choices, the memory, the world or the draft options change, it is
// worked out again after a short pause. The last one stays on screen meanwhile, so nothing flickers.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContextPreview, ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { resolveDraftOptions } from '@/features/generate/draftOptions'
import { quietReason } from './contextLogic'
import { cardLength } from '@shared/defaults'

/** How long to wait after a change before working the briefing out again. */
const PAUSE_MS = 350

export interface ContextPreviewState {
  preview: ContextPreview | null
  /** Why the latest attempt failed (the last good preview, if any, stays on screen). */
  error: string | null
  /** A newer briefing is being worked out. */
  refreshing: boolean
  /** Shows a change straight away while the briefing is worked out again. */
  patch: (fn: (p: ContextPreview) => ContextPreview) => void
  retry: () => void
}

export function useContextPreview(sceneId: ID): ContextPreviewState {
  // The same options Generate would use for this scene.
  const opts = useApp((s) => s.draftOptions[sceneId])
  const defaultCreativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const writerKey = useApp((s) => {
    const w = s.settings?.models.writer
    return w ? `${w.providerId}:${w.modelId}:${w.contextLength ?? ''}` : ''
  })
  const briefingRev = useApp((s) => s.briefingRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)

  const [preview, setPreview] = useState<ContextPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const ticket = useRef(0)
  const loaded = useRef(false)

  useEffect(() => {
    const mine = ++ticket.current
    const run = async (): Promise<void> => {
      setRefreshing(true)
      try {
        // The card's length is read fresh each time, as Adam may just have changed it.
        const scene = await api.getScene(sceneId)
        const p = await api.previewContext(sceneId, resolveDraftOptions(opts, cardLength(scene.card), defaultCreativity))
        if (mine !== ticket.current) return
        loaded.current = true
        setPreview(p)
        setError(null)
      } catch (e) {
        if (mine !== ticket.current) return
        setError(quietReason(e))
      } finally {
        if (mine === ticket.current) setRefreshing(false)
      }
    }
    // The first time straight away; after that, once Adam pauses.
    const t = setTimeout(() => void run(), loaded.current ? PAUSE_MS : 0)
    return () => clearTimeout(t)
  }, [sceneId, opts, defaultCreativity, writerKey, briefingRev, memoryRev, entriesRev, attempt])

  const patch = useCallback((fn: (p: ContextPreview) => ContextPreview) => {
    // A briefing already on its way was worked out before this change: it mustn't undo it on screen.
    ticket.current++
    setRefreshing(false)
    setPreview((p) => (p ? fn(p) : p))
  }, [])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { preview, error, refreshing, patch, retry }
}
