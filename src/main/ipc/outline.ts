// Milestone 4: the handlers for src/shared/contracts/outline.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4".
import type { Handlers } from './index'
import type { OutlineApi } from '@shared/contracts/outline'

export const outlineHandlers: Handlers<keyof OutlineApi> = {}
