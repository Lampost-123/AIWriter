// Milestone 3: the handlers for src/shared/contracts/builder.ts (one part owns both files).
import type { Handlers } from './index'
import type { BuilderApi } from '@shared/contracts/builder'

export const builderHandlers: Handlers<keyof BuilderApi> = {}
