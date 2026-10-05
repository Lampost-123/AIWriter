// Recall in the scene panel (contracts/recall.ts): where things stand as a scene ends, from the continuity tracker
// (continuity/tracker.ts), to browse, put right and read again.
import type { Handlers } from './index'
import type { RecallApi, RecallView } from '@shared/contracts/recall'
import { STATE_FIELDS } from '@shared/continuity'
import type { ID } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import { UserError } from '../util'
import { memoryModel } from '../keeper'
import { editState, stateAfter, stateBefore, storedState } from '../continuity/tracker'

function view(sceneId: ID): RecallView {
  const kept = storedState(world.db(), sceneId)
  return { sceneId, state: kept?.state ?? null, current: kept?.current ?? false, edited: kept?.edited ?? false }
}

const key = (name: string): string => name.trim().toLowerCase()

export const recallHandlers: Handlers<keyof RecallApi> = {
  getRecall: (sceneId) => view(sceneId),
  refreshRecall: async (sceneId) => {
    const w = world.currentWorld()
    const m = memoryModel()
    if ('error' in m) throw new UserError(m.error)
    const o = { db: w.db, model: m, signal: new AbortController().signal, closed: () => !w.db.open || world.maybeCurrentWorld()?.db !== w.db }
    // The scenes before it first (each builds on the last), then the scene itself.
    await stateBefore(o, sceneId)
    const got = await stateAfter(o, sceneId)
    if (!got && repo.getScene(w.db, sceneId).text.trim())
      throw new UserError('The memory model couldn’t work out where things stand. Try again in a moment.')
    return view(sceneId)
  },
  setRecallValue: (sceneId, change) => {
    const value = String(change?.value ?? '').slice(0, 160)
    const db = world.db()
    const ok = editState(db, sceneId, (e) => {
      if (change.character) {
        if (!(STATE_FIELDS as readonly string[]).includes(change.field)) return
        const k = key(change.character)
        e.characters = { ...(e.characters ?? {}), [k]: { ...(e.characters?.[k] ?? {}), name: change.character.trim(), [change.field]: value } }
        // Setting a value for someone taken out brings them back.
        e.removed = (e.removed ?? []).filter((n) => n !== k)
      } else if (change.field === 'time' || change.field === 'weather' || change.field === 'light') {
        e.scene = { ...(e.scene ?? {}), [change.field]: value }
      }
    })
    if (!ok) throw new UserError('Read the scene first, then change what it says.')
    repo.touchWorld(db)
    return view(sceneId)
  },
  removeRecallCharacter: (sceneId, name) => {
    const db = world.db()
    editState(db, sceneId, (e) => {
      const k = key(name)
      e.removed = [...new Set([...(e.removed ?? []), k])]
      if (e.characters) delete e.characters[k]
    })
    repo.touchWorld(db)
    return view(sceneId)
  }
}
