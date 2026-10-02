// How the automatic story flows are doing (time gap, a prequel's starting cast, "When did these
// happen?"), for the quiet line in story settings. The flows run in the background and say how they went
// with 'story:flow' events; a call that fails straight away is recorded the same way. Nothing waits on them.
import { create } from 'zustand'
import type { StoryFlowStatus } from '@shared/contracts/storyFlows'
import type { ID } from '@shared/types'
import { onEvent } from '@/lib/api'

type Flow = StoryFlowStatus['flow']

interface FlowState {
  /** The latest status of each flow, by story. */
  byStory: Record<ID, Partial<Record<Flow, StoryFlowStatus>>>
  set(status: StoryFlowStatus): void
}

export const useFlows = create<FlowState>((set) => ({
  byStory: {},
  set: (status) => set((s) => ({ byStory: { ...s.byStory, [status.storyId]: { ...s.byStory[status.storyId], [status.flow]: status } } }))
}))

let installed = false

/** How to run each flow again, for Try again. */
const again = new Map<string, () => Promise<void>>()

/** Runs a flow again the way it was last started; false when it hasn't been started in this session. */
export function retryFlow(storyId: ID, flow: Flow): boolean {
  const start = again.get(`${storyId}:${flow}`)
  if (start) runFlow(storyId, flow, start)
  return !!start
}

/** Listens for the flows' events, once for the whole window. */
export function installFlowEvents(): void {
  if (installed) return
  installed = true
  onEvent('story:flow', (status) => useFlows.getState().set(status))
}

/**
 * Starts a flow and records it as running. Its own events say how it went; a call that fails at once
 * (no model chosen, or the flows aren't there yet) is recorded with its plain-words message.
 */
export function runFlow(storyId: ID, flow: Flow, start: () => Promise<void>): void {
  installFlowEvents()
  again.set(`${storyId}:${flow}`, start)
  useFlows.getState().set({ storyId, flow, state: 'running', message: null })
  start().catch((e: Error) => useFlows.getState().set({ storyId, flow, state: 'failed', message: e.message }))
}
