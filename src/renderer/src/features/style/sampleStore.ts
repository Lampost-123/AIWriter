// "Write a sample for me" (Style guide): one sample at a time for the world's guide and one for each story's,
// kept while the app is open, so leaving the page and coming back shows it still writing, with Stop.
// Its words arrive through the shared task events (contracts/tasks.ts).
import { create } from 'zustand'
import type { ID, StyleGuide } from '@shared/types'
import { api, ApiError, onEvent } from '@/lib/api'
import { sampleProblem, styleForSample } from './feelLogic'

export interface SampleRun {
  taskId: ID
  /** The sample so far. */
  text: string
  status: 'running' | 'complete' | 'stopped' | 'error'
  /** Plain words when it couldn't start or ended badly. */
  problem: string | null
  /** Plain words while a busy service is being tried again. */
  retrying: string | null
  /** It ran into the length limit, so it stops before its end. */
  cutOff: boolean
}

export const useSamples = create<{ runs: Record<string, SampleRun> }>(() => ({ runs: {} }))

/** Which sample: the world's guide, or a story's, in the world that is open. */
export const sampleKey = (worldId: ID, storyId: ID | null): string => `${worldId}:${storyId ?? 'world'}`

function patch(taskId: ID, p: Partial<SampleRun>): void {
  useSamples.setState((st) => {
    const entry = Object.entries(st.runs).find(([, r]) => r.taskId === taskId)
    if (!entry) return st
    return { runs: { ...st.runs, [entry[0]]: { ...entry[1], ...p } } }
  })
}

let listening = false
function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:progress', (p) => patch(p.taskId, { text: p.text, retrying: null }))
  onEvent('task:retrying', (p) => patch(p.taskId, { retrying: p.reason }))
  onEvent('task:done', (d) =>
    patch(d.taskId, {
      text: d.text,
      status: d.status,
      cutOff: d.cutOff,
      retrying: null,
      problem: d.status === 'error' ? sampleProblem(d.error) : null
    })
  )
}

/** Starts a sample for this guide, replacing any earlier one that has finished. */
export async function writeSample(key: string, storyId: ID | null, style: StyleGuide): Promise<void> {
  listen()
  const now = useSamples.getState().runs[key]
  if (now?.status === 'running') return
  const taskId = crypto.randomUUID()
  const run: SampleRun = { taskId, text: '', status: 'running', problem: null, retrying: null, cutOff: false }
  useSamples.setState((st) => ({ runs: { ...st.runs, [key]: run } }))
  try {
    await api.writeStyleSample({ taskId, storyId, style: styleForSample(style) })
  } catch (e) {
    if (useSamples.getState().runs[key]?.taskId !== taskId) return
    // "Not now" at the spending limit: nothing started, and nothing to say.
    if (e instanceof ApiError && e.code === 'cancelled') return clearSample(key)
    patch(taskId, { status: 'error', problem: sampleProblem((e as Error).message) })
  }
}

export function stopSample(key: string): void {
  const run = useSamples.getState().runs[key]
  if (run?.status === 'running') void api.stopTask(run.taskId).catch(() => undefined)
}

/** Puts the sample away (after Use this, or closing it). */
export function clearSample(key: string): void {
  useSamples.setState((st) => {
    if (!st.runs[key]) return st
    const runs = { ...st.runs }
    delete runs[key]
    return { runs }
  })
}
