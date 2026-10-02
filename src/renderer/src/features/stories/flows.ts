// How the automatic story flows are doing (time gap, a prequel's starting cast, "When did these
// happen?"), for the quiet line in story settings. The flows run in the background and say how they went
// with 'story:flow' events; a call that fails straight away is recorded the same way. Nothing waits on them.
// What is known here is for the open world only: closing a world stops its flows without a word, so
// switching worlds starts afresh.
import { create } from 'zustand'
import type { StoryFlowStatus } from '@shared/contracts/storyFlows'
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'

type Flow = StoryFlowStatus['flow']

const keyOf = (storyId: ID, flow: Flow): string => `${storyId}:${flow}`

interface FlowState {
  /** The latest status of each flow, by story. */
  byStory: Record<ID, Partial<Record<Flow, StoryFlowStatus>>>
  /** What each flow was started about, for its quiet line: the time gap ("200 years") or the book ("Book 2"). */
  about: Record<string, string>
  set(status: StoryFlowStatus): void
}

export const useFlows = create<FlowState>((set) => ({
  byStory: {},
  about: {},
  set: (status) => set((s) => ({ byStory: { ...s.byStory, [status.storyId]: { ...s.byStory[status.storyId], [status.flow]: status } } }))
}))

/** What a flow was last started about ('' when it hasn't been started in this session). */
export const useFlowAbout = (storyId: ID, flow: Flow): string => useFlows((s) => s.about[keyOf(storyId, flow)] ?? '')

let installed = false

/** How to run each flow again, for Try again. */
const again = new Map<string, () => Promise<void>>()

/** Forgets every flow: the world they belong to has closed. */
function forget(): void {
  again.clear()
  useFlows.setState({ byStory: {}, about: {} })
}

/** Whether a flow can be run again the way it was last started (it was started in this world, in this session). */
export const canRetry = (storyId: ID, flow: Flow): boolean => again.has(keyOf(storyId, flow))

/** Runs a flow again the way it was last started; false when it hasn't been started in this session. */
export function retryFlow(storyId: ID, flow: Flow): boolean {
  const start = again.get(keyOf(storyId, flow))
  if (start) runFlow(storyId, flow, start, useFlows.getState().about[keyOf(storyId, flow)])
  return !!start
}

/** Listens for the flows' events, once for the whole window. */
export function installFlowEvents(): void {
  if (installed) return
  installed = true
  onEvent('story:flow', (status) => useFlows.getState().set(status))
  // A flow still running when its world closes is stopped without a word, so kept here it would look stuck.
  useApp.subscribe((s, prev) => {
    if (s.world?.id !== prev.world?.id) forget()
  })
}

/** Whether a flow is running for a story now (a second start would only repeat it). */
export const flowRunning = (storyId: ID, flow: Flow): boolean => useFlows.getState().byStory[storyId]?.[flow]?.state === 'running'

/**
 * Starts a flow and records it as running. Its own events say how it went; a call that fails at once
 * (no model chosen, or the flows aren't there yet) is recorded with its plain-words message. `about`
 * names what it works on, for the quiet line.
 */
export function runFlow(storyId: ID, flow: Flow, start: () => Promise<void>, about = ''): void {
  installFlowEvents()
  const key = keyOf(storyId, flow)
  const worldId = useApp.getState().world?.id
  again.set(key, start)
  useFlows.setState((s) => ({ about: { ...s.about, [key]: about } }))
  useFlows.getState().set({ storyId, flow, state: 'running', message: null })
  start().catch((e: Error) => {
    if (useApp.getState().world?.id === worldId) useFlows.getState().set({ storyId, flow, state: 'failed', message: e.message })
  })
}

/** Stops a running flow. Its own event then says so ("Stopped. Nothing was changed."). */
export const stopFlow = (storyId: ID, flow: Flow): Promise<void> => api.stopStoryFlow(storyId, flow)

/**
 * How a story's flows are doing, for its settings as they open: a run that started before the window
 * heard of it, or how one last went. What the window already knows is newer, so it stays.
 */
export function loadFlows(storyId: ID): void {
  installFlowEvents()
  const worldId = useApp.getState().world?.id
  api
    .listStoryFlows(storyId)
    .then((list) => {
      if (useApp.getState().world?.id !== worldId || !Array.isArray(list)) return
      for (const status of list) {
        if (status?.storyId === storyId && !useFlows.getState().byStory[storyId]?.[status.flow]) useFlows.getState().set(status)
      }
    })
    .catch(() => undefined)
}
