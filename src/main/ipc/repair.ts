// Check and repair (contracts/repair.ts, src/main/repair/): new AI words checked claim by claim as they land. This
// file connects it to the open world, the memory model and the settings. Quiet: with Adam's switch off (Settings ›
// Models, "Check new words straight away"), AIWRITE_REPAIR=off (app tests that aren't about it; it wins over the
// switch), no memory model, or AI spending paused at Adam's limit, nothing is checked.
import type { Handlers } from './index'
import type { RepairApi } from '@shared/contracts/repair'
import * as world from '../world'
import { getSettings, getWritingPrefs } from '../settings'
import { memoryModel } from '../keeper'
import { pausedNote } from '../usage/gate'
import { checkIfWanted, repairsApplied, repairWanted } from '../repair'

const NOTHING = { repairId: null, fixes: [], questions: 0, claims: 0, slips: 0 }

/** The checks under way, with their world: closing a world stops its checks at once (nothing more is written). */
const running = new Map<AbortController, ReturnType<typeof world.db>>()
world.onWorldClosing((w) => {
  for (const [c, db] of running) if (db === w.db) c.abort()
})

export const repairHandlers: Handlers<keyof RepairApi> = {
  checkNewWords: async (input) => {
    const settings = getSettings()
    if (!repairWanted(settings)) return NOTHING
    const w = world.maybeCurrentWorld()
    const m = memoryModel()
    if (!w || 'error' in m || pausedNote()) return NOTHING
    const stop = new AbortController()
    running.set(stop, w.db)
    try {
      return await checkIfWanted(
        { db: w.db, model: m, prefs: getWritingPrefs(), signal: stop.signal, closed: () => stop.signal.aborted || !w.db.open || world.maybeCurrentWorld()?.db !== w.db },
        input,
        settings
      )
    } catch (e) {
      console.warn('Could not check the new words', e)
      return NOTHING
    } finally {
      running.delete(stop)
    }
  },
  repairsApplied: (repairId, applied) => repairsApplied(String(repairId ?? ''), Array.isArray(applied) ? applied : [])
}
