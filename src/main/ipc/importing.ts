// Milestone 6: the handlers for src/shared/contracts/importing.ts (the Manuscript import part).
import type { Handlers } from './index'
import type { ImportingApi } from '@shared/contracts/importing'

export const importingHandlers: Handlers<keyof ImportingApi> = {}
