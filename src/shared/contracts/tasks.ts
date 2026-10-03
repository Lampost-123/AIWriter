// Milestone 4's shared runner for AI calls that aren't scene drafts (src/main/ai/tasks.ts): the AI tools
// for selected words and Continue, Ask the world, the outline helper, next scene ideas and Read aloud's
// AI calls. Owned by the groundwork; each part starts its tasks through its own API (edits.ts, ask.ts...)
// and listens to these events for them.
//
// The interface makes each task's id (any unique id) and passes it to the part's start call, so no event
// can arrive before it knows the id. 'task:progress' carries everything that has arrived so far, about
// every 40 ms; 'task:done' says how it ended. Every call is saved as a generation record, so "What the
// AI saw" works for it (`generationId`).
import type { GenerationJob, ID } from '../types'

export interface TaskProgress {
  taskId: ID
  generationId: ID
  job: GenerationJob
  /** All the reply's text so far (thinking left out). */
  text: string
}

export interface TaskDone extends TaskProgress {
  /** 'stopped' (Stop, or the world closed) and 'error' keep the text that had arrived. */
  status: 'complete' | 'stopped' | 'error'
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
  /** USD, the provider's own figure or an estimate; null when unknown. */
  cost: number | null
  /** The reply ran into the reply limit, so it stops before its end. */
  cutOff: boolean
}

export interface TasksApi {
  /** Stops a task; what had arrived is kept. Resolves once its record is finished. Does nothing for a task that has ended. */
  stopTask(taskId: ID): Promise<void>
}

export interface TasksEvents {
  'task:progress': TaskProgress
  'task:done': TaskDone
  /** Shown while a request is being retried after a rate limit or a server error. */
  'task:retrying': { taskId: ID; attempt: number; waitMs: number; reason: string }
}
