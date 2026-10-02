// How the automatic story flows are doing (time gap, a prequel's starting cast, "When did these
// happen?"), for the quiet line in story settings. The flows run in the background and say how they went
// with 'story:flow' events; a call that fails straight away is recorded the same way. Nothing waits on them.
import { create } from 'zustand'
import type { StoryFlowStatus } from '@shared/contracts/storyFlows'
import type { ID } from '@shared/types'
import { onEvent } from '@/lib/api'

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
  again.set(key, start)
  useFlows.setState((s) => ({ about: { ...s.about, [key]: about } }))
  useFlows.getState().set({ storyId, flow, state: 'running', message: null })
  start().catch((e: Error) => useFlows.getState().set({ storyId, flow, state: 'failed', message: e.message }))
}
