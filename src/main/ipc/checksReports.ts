// Milestone 5, Reports part: the repetition and plot threads reports. Groundwork stubs.
import type { Handlers } from './index'
import { UserError } from '../util'

const notYet = (): never => {
  throw new UserError('The consistency reports are still being built.')
}

export const reportsHandlers: Handlers<'getRepetitionReport' | 'getThreadsReport'> = {
  getRepetitionReport: notYet,
  getThreadsReport: notYet
}
