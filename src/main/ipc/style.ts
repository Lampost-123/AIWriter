// The handlers for src/shared/contracts/style.ts: "Write a sample for me" on the Style guide screen. The work
// is done in src/main/style/.
import type { Handlers } from './index'
import type { StyleApi } from '@shared/contracts/style'
import { writeStyleSample } from '../style'

export const styleHandlers: Handlers<keyof StyleApi> = {
  writeStyleSample: (input) => writeStyleSample(input)
}
