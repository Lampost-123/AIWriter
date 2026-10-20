// Which model each AI job uses while Adam hasn't picked one of its own (Settings › Models' "Same as …"), nearest first,
// and a model's name as Settings shows it. The main process picks its models by this table (ai/jobModel.ts); the window
// names them by it (the top bar's progress card, 2026-10-20: "also show what model is being used when a task is active").
import type { Job, ModelChoice } from './types'

export const MODEL_FALLBACKS: Record<Job, Job[]> = {
  writer: ['writer'],
  memory: ['memory', 'writer'],
  chat: ['chat', 'writer'],
  builder: ['builder', 'writer'],
  speech: ['speech', 'memory', 'writer'],
  world: ['world', 'builder', 'writer'],
  check: ['check', 'memory', 'writer'],
  recipe: ['recipe', 'memory', 'writer'],
  chapter: ['chapter', 'chat', 'writer'],
  director: ['director', 'memory', 'writer']
}

/** The model a job uses with these choices: its own, else the one it is "Same as"; null when none is set. */
export function modelForJob(models: Partial<Record<Job, ModelChoice | null>> | null | undefined, job: Job): ModelChoice | null {
  for (const j of MODEL_FALLBACKS[job]) {
    const m = models?.[j]
    if (m) return m
  }
  return null
}

/** A model's name as Settings › Models shows it, short: "Claude Sonnet 4.6" for "Anthropic: Claude Sonnet 4.6". */
export function shortModelName(m: Pick<ModelChoice, 'label' | 'modelId'>): string {
  const label = (m.label || m.modelId).trim()
  return label.includes(': ') ? label.slice(label.indexOf(': ') + 2) : label
}

/** The name of the model a job uses ('' when none is set). */
export function jobModelName(models: Partial<Record<Job, ModelChoice | null>> | null | undefined, job: Job): string {
  const m = modelForJob(models, job)
  return m ? shortModelName(m) : ''
}
