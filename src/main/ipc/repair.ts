// Check and repair (contracts/repair.ts, src/main/repair/): new AI words checked claim by claim as they land. This
// file connects it to the open world, the memory model and the settings. Quiet: with no memory model, AI spending
// paused at Adam's limit, or AIWRITE_REPAIR=off (app tests that aren't about it), nothing is checked.
import type { Handlers } from './index'
import type { RepairApi } from '@shared/contracts/repair'
import * as world from '../world'
import { getWritingPrefs } from '../settings'
import { memoryModel } from '../keeper'
import { pausedNote } from '../usage/gate'
import { checkNewWords, repairsApplied } from '../repair'

const NOTHING = { repairId: null, fixes: [], questions: 0, claims: 0, slips: 0 }

export const repairHandlers: Handlers<keyof RepairApi> = {
  checkNewWords: async (input) => {
    if (process.env.AIWRITE_REPAIR === 'off') return NOTHING
    const w = world.maybeCurrentWorld()
    const m = memoryModel()
    if (!w || 'error' in m || pausedNote()) return NOTHING
    try {
      return await checkNewWords({ db: w.db, model: m, prefs: getWritingPrefs(), closed: () => !w.db.open || world.maybeCurrentWorld()?.db !== w.db }, input)
    } catch (e) {
      console.warn('Could not check the new words', e)
      return NOTHING
    }
  },
  repairsApplied: (repairId, applied) => repairsApplied(String(repairId ?? ''), Array.isArray(applied) ? applied : [])
}
