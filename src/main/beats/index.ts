// Writing one beat (milestone 4, Beat by beat). The scene card must have the beat; its briefing is a
// draft's (draftBriefing: the memory catches up with earlier scenes first, before the first beat only)
// with Beat by beat's own closing instruction and the scene so far; then the shared draft runner writes
// it as a 'beat' record that streams into the page like a draft. Works on the open world and the app's
// settings; ipc/beats.ts connects it to the window.

import type { BeatStart } from '@shared/contracts/beats'
import type { DraftOptions, ID } from '@shared/types'
import * as repo from '../db/repo'
import { newId, UserError } from '../util'
import * as world from '../world'
import { getSettings } from '../settings'
import { cleanOptions } from '../ai/gather'
import { draftBriefing, providerNotes, type DraftBriefing } from '../ai/draftFlow'
import { isDrafting, startDraftJob, type Emit } from '../ai/drafts'
import { beatDirection, beatInstruction, beatWords, cardBeats, soFarBlock, tidySteer } from './instructions'

const BUSY = 'A draft is already being written for this scene. Stop it first, or wait for it to finish.'

/** Scenes whose next beat is being started (the memory may be catching up first), with how to stop each. */
const starting = new Map<ID, AbortController>()

/** True while a beat of this scene is being started. */
export const isStartingBeat = (sceneId: ID): boolean => starting.has(sceneId)

/** The scene card's beats, or a plain-words reason there is no beat `index` to write. */
function beatsFor(sceneId: ID, index: number): string[] {
  const beats = cardBeats(repo.getScene(world.db(), sceneId).card.beats)
  if (!beats.length) {
    throw new UserError(
      "This scene's card has no beats, so there's nothing to write beat by beat. Add the beats on the scene card first.",
      'no-beats'
    )
  }
  if (index > beats.length) {
    const has = beats.length === 1 ? 'one beat' : `${beats.length} beats`
    throw new UserError(`The scene card has ${has} now, so there's no beat ${index} to write.`, 'no-such-beat')
  }
  return beats
}

/**
 * Starts writing beat `index` of the scene card. `otherStarting` says whether another draft of the scene
 * (Generate's) is being started, so two never write into the page at once.
 */
export async function startBeat(
  input: BeatStart,
  o: { emit: Emit; otherStarting?: (sceneId: ID) => boolean }
): Promise<{ generationId: ID; of: number }> {
  const sceneId = input.sceneId
  if (isDrafting(sceneId) || starting.has(sceneId) || o.otherStarting?.(sceneId)) throw new UserError(BUSY)
  const index = Math.floor(Number(input.index))
  if (!Number.isFinite(index) || index < 1) throw new UserError('That beat is not on the scene card.', 'no-such-beat')
  const db = world.db()
  const sessionId = typeof input.sessionId === 'string' && input.sessionId ? input.sessionId.slice(0, 64) : newId()
  const steer = tidySteer(input.steer)
  const block = soFarBlock(typeof input.soFar === 'string' ? input.soFar : '', getSettings().models.writer?.contextLength ?? null)

  const stop = new AbortController()
  starting.set(sceneId, stop)
  try {
    let beats = beatsFor(sceneId, index)
    // The scene's length (from the draft options, else the scene card) is shared out between the beats.
    const scene = cleanOptions(input.options, { targetWords: repo.getScene(db, sceneId).card.targetWords || 1500, creativity: 'balanced' })
    const briefing = (catchUp: boolean): Promise<DraftBriefing> => {
      const options: Partial<DraftOptions> = { ...input.options, targetWords: beatWords(scene.targetWords, beats.length) }
      return draftBriefing(sceneId, options, {
        extras: {
          final: (f) => beatInstruction(f, { index, beats, steer, hasSoFar: !!block }),
          extraBlocks: block ? [block] : []
        },
        signal: stop.signal,
        catchUp
      })
    }
    let b = await briefing(index === 1)
    // The beats were changed on the card while the memory caught up: ask for the beat as the card has it now.
    const now = beatsFor(sceneId, index)
    if (now.join('\n') !== beats.join('\n')) {
      beats = now
      b = await briefing(false)
    }
    const { generationId } = startDraftJob({
      db,
      sceneId,
      job: 'beat',
      partOf: { beat: { sessionId, index, of: beats.length } },
      options: { ...b.input.options, direction: beatDirection(b.input.options.direction, steer) },
      preview: b.preview,
      provider: b.target,
      model: b.choice,
      thinking: b.thinking,
      entryVersions: b.entryVersions,
      emit: o.emit,
      ...providerNotes(b.target.id)
    })
    return { generationId, of: beats.length }
  } finally {
    if (starting.get(sceneId) === stop) starting.delete(sceneId)
  }
}

/** Calls off a beat that is still getting ready: nothing more is done or sent. */
export function cancelBeatStart(sceneId: ID): void {
  starting.get(sceneId)?.abort()
}
