// The name of the model a job uses, as Settings › Models shows it ('' when none is set), for the top bar's hovers while
// an AI task is at work (Adam, 2026-10-20: "also show what model is being used when a task is active").
import type { Job } from '@shared/types'
import { jobModelName } from '@shared/modelJobs'
import { useApp } from '@/lib/store'

export function useModelName(job: Job): string {
  return useApp((s) => jobModelName(s.settings?.models, job))
}

/** " Model: DeepSeek V4 Flash." after a hover's words ('' when no model is set). */
export const modelSuffix = (name: string): string => (name ? ` Model: ${name}.` : '')
