// Milestone 4: the handlers for src/shared/contracts/ask.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4".
import type { Handlers } from './index'
import type { AskApi } from '@shared/contracts/ask'

export const askHandlers: Handlers<keyof AskApi> = {}
