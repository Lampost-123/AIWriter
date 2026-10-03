// Milestone 6: the handlers for src/shared/contracts/usage.ts (the Usage and cost part). The work is done in
// src/main/usage/; importing it sets the monthly limit's hooks into the AI calls (usage/gate.ts).
import type { Handlers } from './index'
import type { UsageApi } from '@shared/contracts/usage'
import * as usage from '../usage'

export const usageHandlers: Handlers<keyof UsageApi> = {
  getUsage: (query) => usage.usageReport(query),
  getSpendState: () => usage.spendState(),
  setMonthlyLimit: (limit) => usage.setMonthlyLimit(limit),
  carryOnThisMonth: () => usage.carryOnThisMonth(),
  spendToastShown: (which) => usage.spendToastShown(which)
}
