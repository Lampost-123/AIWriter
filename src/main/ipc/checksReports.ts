// Milestone 5, Reports part: the repetition and plot threads reports. The work is in src/main/checks/reports.ts.
import type { Handlers } from './index'
import * as world from '../world'
import { repetitionReportOf, threadsReportOf } from '../checks/reports'

export const reportsHandlers: Handlers<'getRepetitionReport' | 'getThreadsReport'> = {
  getRepetitionReport: (storyId) => repetitionReportOf(world.db(), storyId),
  getThreadsReport: (storyId) => threadsReportOf(world.db(), storyId)
}
