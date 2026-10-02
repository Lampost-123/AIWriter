// Milestone 4: the handlers for src/shared/contracts/dictation.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4".
import type { Handlers } from './index'
import type { DictationApi } from '@shared/contracts/dictation'

export const dictationHandlers: Handlers<keyof DictationApi> = {}
