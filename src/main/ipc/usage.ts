// Milestone 6: the handlers for src/shared/contracts/usage.ts (the Usage and cost part).
import type { Handlers } from './index'
import type { UsageApi } from '@shared/contracts/usage'

export const usageHandlers: Handlers<keyof UsageApi> = {}
