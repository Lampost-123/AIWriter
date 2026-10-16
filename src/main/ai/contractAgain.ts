// A scene's contract made again (long story memory fix 13; review, 2026-10-16): Write the whole chapter checks each scene
// through the contract its draft was written to, and kept that one for every check after, though a review may have
// changed the scene before since (her dress back on) and with it what must be true at this one's start. Made again from
// what the draft was asked for, with the memory and where things stand as they are now. No AI call, no Electron imports.

import type Database from 'better-sqlite3'
import type { DraftOptions, ID, WritingPrefs } from '@shared/types'
import { prepareContext, type ContextExtras } from './context'
import type { SceneContract } from './contract'
import { gatherContextInput } from './gather'

/** What a scene's draft was asked for, as its contract is made from it. */
export interface ContractAsked {
  options: Partial<DraftOptions>
  /** What the plan before writing said must change (plan/plan.ts), when it said anything. */
  planned?: string[]
  /** The draft's extra blocks (the chapter writer's notes from studying the chapter). */
  extras?: ContextExtras
}

/** The contract as a whole scene's draft would be given it now; null when `wanted` is false or it would say nothing. */
export function contractAgain(
  db: Database.Database,
  sceneId: ID,
  asked: ContractAsked,
  o: { prefs: WritingPrefs; contextLength: number | null; maxOutput?: number | null; creativity: DraftOptions['creativity']; wanted: boolean }
): SceneContract | null {
  if (!o.wanted) return null
  const input = gatherContextInput(db, sceneId, asked.options, o)
  input.contract = { asks: 'scene', ...(asked.planned?.length ? { planned: asked.planned } : {}) }
  // As the draft's briefing had it (draftFlow.ts assemble): the extra blocks' words count as the scene's.
  const soFar = (asked.extras?.extraBlocks ?? []).map((b) => b.text).join('\n\n')
  if (soFar.trim()) input.soFar = soFar
  return prepareContext(input, asked.extras).contract ?? null
}
