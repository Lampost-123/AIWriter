// Milestone 4: the handlers for src/shared/contracts/readAloud.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4".
import type { Handlers } from './index'
import type { ReadAloudApi } from '@shared/contracts/readAloud'

export const readAloudHandlers: Handlers<keyof ReadAloudApi> = {}
