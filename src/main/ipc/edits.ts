// Milestone 4: the handlers for src/shared/contracts/edits.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The work is done in src/main/edits/.
import type { Handlers } from './index'
import type { EditsApi } from '@shared/contracts/edits'
import { startEdit } from '../edits'

export const editsHandlers: Handlers<keyof EditsApi> = {
  startEdit: (input) => startEdit(input)
}
