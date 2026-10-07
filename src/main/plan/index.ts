// Plan before writing, on the open world (plan.ts does the work): whether to plan at all, with which model, and from
// which briefing. ai/draftFlow.ts asks for a plan before Generate, Add below and each beat (not Variants: one plan for a
// set would make its drafts alike, and choice is what they are for).

import type Database from 'better-sqlite3'
import type { ContextPreview, ID } from '@shared/types'
import { getSettings } from '../settings'
import * as world from '../world'
import { memoryModel } from '../keeper'
import { pausedNote } from '../usage/gate'
import type { ContextInput, PreparedContext } from '../ai/context'
import { SO_FAR_BLOCK } from '../beats/instructions'
import { makePlan, planMaterial, type MadePlan } from './plan'

/**
 * Whether drafts plan first: Settings › Models, "Plan before writing" (on unless Adam turns it off). App tests that
 * aren't about planning turn it off with AIWRITE_PLAN=off, so they make no extra call.
 */
export function planWanted(): boolean {
  if (process.env.AIWRITE_PLAN === 'off') return false
  return getSettings().planFirst !== false
}

/**
 * The plan for a draft about to be written from this briefing, made with the memory model (and its Thinking, Off unless
 * Adam changed it); null when planning is off, the memory model isn't set up or is paused (the month's spending limit),
 * or the plan failed, was stopped or took too long. Never throws. `focus`: for Beat by beat, the one beat to plan.
 */
export async function planBeforeWriting(
  db: Database.Database,
  sceneId: ID,
  b: { input: ContextInput; preview: ContextPreview; prepared: Pick<PreparedContext, 'finals'> },
  signal?: AbortSignal,
  focus = ''
): Promise<MadePlan | null> {
  try {
    if (!planWanted() || pausedNote()) return null
    const model = memoryModel()
    if ('error' in model) return null
    const live = (): boolean => db.open && world.maybeCurrentWorld()?.db === db
    const entries = b.preview.entries ?? []
    return await makePlan({
      db,
      model,
      sceneId,
      material: planMaterial(b.input, b.preview, b.prepared, focus),
      check: {
        stand: b.input.continuity,
        entries: b.input.memory.entries,
        inBriefing: new Set(entries.filter((e) => !e.hidden && e.blockId).map((e) => e.entryId)),
        hidden: new Set(entries.filter((e) => e.hidden).map((e) => e.entryId))
      },
      carryingOn: b.preview.blocks.some((x) => x.id === SO_FAR_BLOCK && !x.dropped),
      signal,
      closed: () => !live()
    })
  } catch (e) {
    console.warn('Could not plan the scene; writing without a plan', e)
    return null
  }
}
