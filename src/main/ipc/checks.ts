// Milestone 5: the handlers for src/shared/contracts/checks.ts. Groundwork stubs; each part replaces its own
// handlers (Live checks: the live ones; AI checks: issues and runs; Reports: the reports).
import type { Handlers } from './index'
import type { ChecksApi } from '@shared/contracts/checks'
import { UserError } from '../util'

const notYet = (): never => {
  throw new UserError('The consistency checker is still being built.')
}

export const checksHandlers: Handlers<keyof ChecksApi> = {
  getCheckWords: () => ({ names: [], avoid: [] }),
  listLiveIgnores: () => [],
  ignoreLive: () => undefined,
  unignoreLive: () => undefined,
  listIssues: () => [],
  listStoryIssues: () => [],
  issueCounts: () => ({}),
  ignoreIssue: notYet,
  reopenIssue: notYet,
  markIssueFixed: notYet,
  updateMemoryFromIssue: notYet,
  startCheck: notYet,
  stopCheck: () => undefined,
  getRepetitionReport: notYet,
  getThreadsReport: notYet
}
