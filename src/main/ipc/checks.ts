// Milestone 5: the handlers for src/shared/contracts/checks.ts, one file per part (each replaces its own
// groundwork stubs): checksLive.ts (Live checks), checksIssues.ts (AI checks), checksReports.ts (Reports).
import type { Handlers } from './index'
import type { ChecksApi } from '@shared/contracts/checks'
import { liveHandlers } from './checksLive'
import { issuesHandlers } from './checksIssues'
import { reportsHandlers } from './checksReports'

export const checksHandlers: Handlers<keyof ChecksApi> = { ...liveHandlers, ...issuesHandlers, ...reportsHandlers }
