// Milestone 6: the handlers for src/shared/contracts/transfer.ts (the World files and export part).
import type { Handlers } from './index'
import type { TransferApi } from '@shared/contracts/transfer'

export const transferHandlers: Handlers<keyof TransferApi> = {}
