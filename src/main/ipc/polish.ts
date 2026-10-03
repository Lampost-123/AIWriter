// The handlers for src/shared/contracts/polish.ts: the polish pass after a Generate draft. The work is done in
// src/main/style/.
import type { Handlers } from './index'
import type { PolishApi } from '@shared/contracts/polish'
import { startPolish } from '../style'

export const polishHandlers: Handlers<keyof PolishApi> = {
  startPolish: (input) => startPolish(input)
}
