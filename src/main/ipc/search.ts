// Milestone 3: the handlers for src/shared/contracts/search.ts (one part owns both files).
import type { Handlers } from './index'
import type { SearchApi } from '@shared/contracts/search'

export const searchHandlers: Handlers<keyof SearchApi> = {}
