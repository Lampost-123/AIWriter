// The handlers for src/shared/contracts/director.ts: Directed writing. The stretch loop is in src/main/director/; a
// directed draft is started, stopped and heard as any Generate draft is (ipc/ai.ts).
import type { Handlers } from './index'
import { addNote } from '../director'

export const directorHandlers: Handlers<'directorNote'> = {
  directorNote: (generationId, note) => addNote(generationId, note)
}
