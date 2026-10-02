// Milestone 3: the handlers for src/shared/contracts/entryViews.ts (one part owns both files).
import type { Handlers } from './index'
import type { EntryViewsApi } from '@shared/contracts/entryViews'

export const entryViewsHandlers: Handlers<keyof EntryViewsApi> = {}
