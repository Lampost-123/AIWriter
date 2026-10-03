// Milestone 6: the handlers for src/shared/contracts/transfer.ts (the World files and export part). The work is
// done in src/main/transfer/; this file only passes the calls on.
import type { Handlers } from './index'
import type { TransferApi } from '@shared/contracts/transfer'
import * as transfer from '../transfer'

export const transferHandlers: Handlers<keyof TransferApi> = {
  exportStory: (input) => transfer.exportStory(input),
  exportBible: (input) => transfer.exportBible(input),
  exportWorldFile: (input) => transfer.exportWorldFile(input.jobId, input.worldId ?? null),
  importWorldFile: (input) => transfer.importWorldFile(input.jobId),
  copyWorld: (input) => transfer.copyWorld(input.jobId, input.worldId),
  showExported: (path) => transfer.showExported(path)
}
