// Milestone 5, Reports part: the repetition and plot threads reports. The work is in src/main/checks/reports.ts.
import type { Handlers } from './index'
import * as world from '../world'
import { repetitionReportOf, threadsReportOf } from '../checks/reports'
import { checkReportNow } from '../checks/report'

export const reportsHandlers: Handlers<'getRepetitionReport' | 'getThreadsReport' | 'getCheckReport'> = {
  getRepetitionReport: (storyId) => repetitionReportOf(world.db(), storyId),
  getThreadsReport: (storyId) => threadsReportOf(world.db(), storyId),
  // The critic's latest report for a scene (checks/report.ts), saying whether the scene's words have changed since.
  getCheckReport: (sceneId) => checkReportNow(world.db(), sceneId)
}
