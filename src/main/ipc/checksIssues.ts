// Milestone 5, AI checks part: issues and check runs. Groundwork stubs.
import type { Handlers } from './index'
import { UserError } from '../util'

const notYet = (): never => {
  throw new UserError('The consistency checker is still being built.')
}

export const issuesHandlers: Handlers<
  | 'listIssues'
  | 'listStoryIssues'
  | 'issueCounts'
  | 'ignoreIssue'
  | 'reopenIssue'
  | 'markIssueFixed'
  | 'updateMemoryFromIssue'
  | 'startCheck'
  | 'stopCheck'
> = {
  listIssues: () => [],
  listStoryIssues: () => [],
  issueCounts: () => ({}),
  ignoreIssue: notYet,
  reopenIssue: notYet,
  markIssueFixed: notYet,
  updateMemoryFromIssue: notYet,
  startCheck: notYet,
  stopCheck: () => undefined
}
