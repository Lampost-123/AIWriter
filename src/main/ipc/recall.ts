// Recall in the scene panel (contracts/recall.ts): where things stand as a scene ends, or at the cursor, from the
// continuity tracker (continuity/tracker.ts), to browse, put right and read again.
import type { Handlers } from './index'
import type { RecallApi, RecallAtView, RecallView } from '@shared/contracts/recall'
import { LONGEST_VALUE, STATE_FIELDS } from '@shared/continuity'
import type { ID } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import { UserError } from '../util'
import { memoryModel } from '../keeper'
import { editState, keptStateBefore, stateAfter, stateAtText, stateBefore, storedState, storedStateAt } from '../continuity/tracker'

function view(sceneId: ID): RecallView {
  const kept = storedState(world.db(), sceneId)
  return { sceneId, state: kept?.state ?? null, current: kept?.current ?? false, edited: kept?.edited ?? false }
}

function viewAt(sceneId: ID, words: string): RecallAtView {
  const db = world.db()
  // At the very start of the scene: as the scene before ended.
  if (!words.trim()) return { sceneId, state: keptStateBefore(db, sceneId), exact: true }
  const kept = storedStateAt(db, sceneId, words)
  return { sceneId, state: kept?.current ? kept.state : null, exact: !!kept?.current && kept.exact }
}

/** The memory model and how to tell the world closed, for a reading Adam asked for; a plain-words error when there is none. */
function asked(): { db: ReturnType<typeof world.db>; o: Parameters<typeof stateAfter>[0] } {
  const w = world.currentWorld()
  const m = memoryModel()
  if ('error' in m) throw new UserError(m.error)
  return { db: w.db, o: { db: w.db, model: m, signal: new AbortController().signal, closed: () => !w.db.open || world.maybeCurrentWorld()?.db !== w.db } }
}

const key = (name: string): string => name.trim().toLowerCase()

export const recallHandlers: Handlers<keyof RecallApi> = {
  getRecall: (sceneId) => view(sceneId),
  refreshRecall: async (sceneId) => {
    const { db, o } = asked()
    // The scenes before it first (each builds on the last), then the scene itself.
    await stateBefore(o, sceneId)
    const got = await stateAfter(o, sceneId)
    if (!got && repo.getScene(db, sceneId).text.trim()) throw new UserError('The memory model couldn’t work out where things stand. Try again in a moment.')
    return view(sceneId)
  },
  getRecallAt: (sceneId, words) => viewAt(sceneId, String(words ?? '')),
  refreshRecallAt: async (sceneId, words) => {
    const text = String(words ?? '')
    const { o } = asked()
    const got = await stateAtText(o, sceneId, text)
    if (!got && text.trim()) throw new UserError('The memory model couldn’t work out where things stand. Try again in a moment.')
    return viewAt(sceneId, text)
  },
  setRecallValue: (sceneId, change) => {
    const value = String(change?.value ?? '').slice(0, LONGEST_VALUE)
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
