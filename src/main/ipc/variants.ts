// Milestone 4: the handlers for src/shared/contracts/variants.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4".
import type { Handlers } from './index'
import type { VariantsApi } from '@shared/contracts/variants'

export const variantsHandlers: Handlers<keyof VariantsApi> = {}
