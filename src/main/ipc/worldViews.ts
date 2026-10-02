// Milestone 3: the handlers for src/shared/contracts/worldViews.ts (one part owns both files).
import type { Handlers } from './index'
import type { WorldViewsApi } from '@shared/contracts/worldViews'

export const worldViewsHandlers: Handlers<keyof WorldViewsApi> = {}
