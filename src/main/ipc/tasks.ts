// Milestone 4: the handlers for src/shared/contracts/tasks.ts (the groundwork owns both files). The
// tasks themselves are started by each part's own calls (edits, Ask the world, outline, read aloud).
import type { Handlers } from './index'
import type { TasksApi } from '@shared/contracts/tasks'
import { stopTask } from '../ai/tasks'

export const tasksHandlers: Handlers<keyof TasksApi> = {
  stopTask: (taskId) => stopTask(taskId)
}
