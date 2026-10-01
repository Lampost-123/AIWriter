// Providers, models and generation. OWNED BY THE AI WORKER: replace these stubs
// with src/main/ai/* (provider layer, context assembly, generation records).
import type { Handlers } from './index'
import { UserError } from '../util'

type AiMethods =
  | 'listProviders' | 'saveProvider' | 'deleteProvider' | 'testProvider' | 'listModels'
  | 'previewContext' | 'startDraft' | 'stopGeneration' | 'listGenerations' | 'getGeneration'

const notYet = (): never => {
  throw new UserError('Model connection is not ready yet.')
}

export const aiHandlers: Handlers<AiMethods> = {
  listProviders: () => [],
  saveProvider: notYet,
  deleteProvider: notYet,
  testProvider: notYet,
  listModels: () => [],
  previewContext: notYet,
  startDraft: notYet,
  stopGeneration: () => undefined,
  listGenerations: () => [],
  getGeneration: notYet
}
