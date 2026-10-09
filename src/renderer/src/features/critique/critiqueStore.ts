// The Critique tab's data (the scene and chapter critic, contracts/critique.ts): the latest critique kept for each
// scene and chapter (loaded once, then checked against the saved words every few seconds while it shows, so the tab
// can say they have changed since), the critiques being written now (with their task ids, for Stop), and the last one that went wrong. A
// critique keeps going when Adam moves to another scene, so coming back shows it. Whether the tab shows the scene or
// its chapter is kept while the app is open.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { CritiqueScope, CritiqueTarget, SavedCritique } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, type ApiError } from '@/lib/api'
import { flushAll, registerDiscarder } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'

interface CritiqueState {
  /** By targetKey: the latest kept critique, null when there is none, missing until loaded. */
  saved: Record<string, SavedCritique | null>
  /** Critiques being written now, by targetKey. */
  runs: Record<string, { taskId: ID }>
  /** The last critique asked for that went wrong, by targetKey, in plain words. Cleared when another starts. */
  failed: Record<string, string>
  /** Whether the tab shows the open scene's critique or its chapter's. */
  scope: CritiqueScope
}

export const useCritiqueStore = create<CritiqueState>(() => ({ saved: {}, runs: {}, failed: {}, scope: 'scene' }))

export const targetKey = (t: CritiqueTarget): string => `${t.scope}:${t.id}`

const patch = <K extends 'saved' | 'runs' | 'failed'>(field: K, key: string, value: CritiqueState[K][string] | undefined): void =>
  useCritiqueStore.setState((s) => {
    const next = { ...s[field] } as Record<string, unknown>
    if (value === undefined) delete next[key]
    else next[key] = value
    return { [field]: next } as Partial<CritiqueState>
  })

export const setScope = (scope: CritiqueScope): void => useCritiqueStore.setState({ scope })

/** The newest load asked for each target: only its answer is kept. */
const asked = new Map<string, number>()
let loads = 0

/** Loads the latest critique kept for the target (and whether its words have changed since). */
export async function loadCritique(target: CritiqueTarget): Promise<void> {
  const key = targetKey(target)
  const n = ++loads
  asked.set(key, n)
  try {
    const got = await api.getCritique(target)
    if (asked.get(key) === n) patch('saved', key, got)
  } catch {
    // Said by the tab as "no critique yet"; asking again works as usual.
    if (asked.get(key) === n && !(key in useCritiqueStore.getState().saved)) patch('saved', key, null)
  }
}

/** How often a kept critique shown in the tab is checked against the words (a cheap call: no AI). */
export const CHANGED_CHECK_MS = 2500

/**
 * The target's latest critique, loaded when first shown, and checked against the saved words every few seconds while
 * it shows and still matches them (so the tab can say they have changed since). Undefined while the first load is on
 * its way.
 */
export function useCritique(target: CritiqueTarget | null): SavedCritique | null | undefined {
  const key = target ? targetKey(target) : ''
  const saved = useCritiqueStore((s) => (key ? s.saved[key] : null))
  const scope = target?.scope
  const id = target?.id
  useEffect(() => {
    if (scope && id) void loadCritique({ scope, id })
  }, [scope, id])
  // Once it has changed it stays so until the next critique, so there is nothing more to check.
  const watching = !!saved && !saved.changed
  useEffect(() => {
    if (!scope || !id || !watching) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadCritique({ scope, id })
    }, CHANGED_CHECK_MS)
    return () => clearInterval(timer)
  }, [scope, id, watching])
  return saved
}

/**
 * Asks for a critique of the scene or chapter, after the page's last words are saved. One for the same target already
 * being written carries on instead. What went wrong is shown in the tab; a stopped one leaves the one before.
 */
export async function startCritique(target: CritiqueTarget): Promise<void> {
  const key = targetKey(target)
  if (useCritiqueStore.getState().runs[key]) return
  const taskId = globalThis.crypto.randomUUID()
  patch('failed', key, undefined)
  patch('runs', key, { taskId })
  try {
    await flushAll()
    const out = await api.startCritique({ taskId, target })
    if (useCritiqueStore.getState().runs[key]?.taskId !== taskId) return
    if (out.status === 'complete') {
      // A load still on its way read the critique before this one: its answer is dropped.
      asked.set(key, ++loads)
      patch('saved', key, { critique: out.critique, changed: false })
    } else if (out.status === 'error') patch('failed', key, out.error)
    // Written while Adam was in another scene (or on another tab): a quiet word that it is ready.
    if (out.status === 'complete' && !shownNow(target)) {
      toast(
        target.scope === 'scene'
          ? 'The scene’s critique is ready, in the Critique tab.'
          : 'The chapter’s critique is ready, in the Critique tab.'
      )
    }
  } catch (e) {
    if (useCritiqueStore.getState().runs[key]?.taskId === taskId) patch('failed', key, (e as ApiError).message || plainReason(e))
  } finally {
    if (useCritiqueStore.getState().runs[key]?.taskId === taskId) patch('runs', key, undefined)
  }
}

/** Stops the critique being written; the one kept before stays. */
export function stopCritique(target: CritiqueTarget): void {
  const run = useCritiqueStore.getState().runs[targetKey(target)]
  if (run) void api.stopTask(run.taskId).catch(() => undefined)
}

/** The tab is showing this target now. */
function shownNow(target: CritiqueTarget): boolean {
  const app = useApp.getState()
  return (
    app.view.kind === 'write' &&
    app.inspectorTab === 'critique' &&
    !!app.settings?.layout.inspectorOpen &&
    shownTarget === targetKey(target)
  )
}

/** What the tab is showing (its targetKey), kept by the tab itself. */
let shownTarget: string | null = null
export const noteShown = (key: string | null): void => {
  shownTarget = key
}

// Another world (or a restored backup): what was loaded belongs to the world before. A critique still being written
// was stopped with that world.
registerDiscarder(() => {
  asked.clear()
  useCritiqueStore.setState({ saved: {}, runs: {}, failed: {} })
})
