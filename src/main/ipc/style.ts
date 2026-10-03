// The handlers for src/shared/contracts/style.ts: "Write a sample for me" on the Style guide screen.
import type { Handlers } from './index'
import type { StyleApi } from '@shared/contracts/style'
import { UserError } from '../util'

export const styleHandlers: Handlers<keyof StyleApi> = {
  writeStyleSample: () => {
    throw new UserError('Writing a sample isn’t ready yet.')
  }
}
