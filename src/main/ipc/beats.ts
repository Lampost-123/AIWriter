// Milestone 4: the handlers for src/shared/contracts/beats.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4".
import type { Handlers } from './index'
import type { BeatsApi } from '@shared/contracts/beats'

export const beatsHandlers: Handlers<keyof BeatsApi> = {}
