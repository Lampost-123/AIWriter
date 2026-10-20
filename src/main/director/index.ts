// Directed writing (Adam's spec, "Directed writing (an option)", 2026-10-19): whether a draft is directed, and the
// director for a draft from its briefing. Generate, Add below and Write the chapter's drafts are directed when the draft
// options say so, or, when they don't, Settings › Models' "Directed writing" (off by default); Continue, Beat by beat and
// Variants never are. See run.ts for the stretch loop. Works on the open world's database and the app's settings.

import type Database from 'better-sqlite3'
import type { DraftOptions, ID, Settings } from '@shared/types'
import { beatsOnPage } from '@shared/beats'
import type { DraftBriefing } from '../ai/draftFlow'
import type { DraftStream, Emit } from '../ai/drafts'
import { jobModel, type JobModel, type ModelSources } from '../ai/jobModel'
import { checkWorld } from './checks'
import { directedStream } from './run'
import { planStretches } from './stretch'

export { addNote, isDirected } from './live'

/**
 * Whether a draft is directed: its own draft options (`directed`, for one draft), else Settings › Models. App tests and
 * the trap harness set AIWRITE_DIRECTED=on (or off) in place of the setting; a draft's own choice still stands.
 */
export function directedWanted(
  options: Pick<Partial<DraftOptions>, 'directed'> | undefined,
  settings: Partial<Pick<Settings, 'directedWriting'>>,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (typeof options?.directed === 'boolean') return options.directed
  if (env.AIWRITE_DIRECTED === 'on') return true
  if (env.AIWRITE_DIRECTED === 'off') return false
  return settings.directedWriting === true
}

/** The director model (Settings › Models, "Director model": the memory model unless Adam picks another); null when none can be reached. */
export function directorModel(src: ModelSources): JobModel | null {
  try {
    return jobModel('director', src)
  } catch {
    return null
  }
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * The director for one draft, from its briefing: the stretches follow the scene plan's beats when it made one (else the
 * card's: for Add below, those not on the page yet), at the draft's length; the checklist is the scene contract's "must
 * change" asks (ai/contract.ts, the same list the check as words land goes through); the closing image is the plan's.
 * `carryOn`: the scene's words an Add below carries on from.
 */
export function directDraft(o: {
  db: Database.Database
  sceneId: ID
  briefing: Pick<DraftBriefing, 'input' | 'contract' | 'scenePlan'>
  carryOn: string
  model: JobModel | null
  emit: Emit
  quiet?: boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}): DraftStream {
  const { input, contract, scenePlan } = o.briefing
  const card = input.scene.card
  const carryOn = o.carryOn ?? ''
  const cardBeats = card.beats.map(clean).filter(Boolean)
  const beats = scenePlan?.beats.length ? scenePlan.beats : carryOn.trim() ? cardBeats.slice(beatsOnPage(cardBeats, carryOn)) : cardBeats
  const plan = planStretches(beats, input.options.targetWords)
  const asks = (contract?.items ?? []).filter((i) => i.part === 'change').map((i) => clean(i.text))
  return directedStream({
    db: o.db,
    sceneId: o.sceneId,
    plan,
    closing: clean(scenePlan?.closing ?? ''),
    asks,
    direction: input.options.direction,
    carryOn,
    checks: checkWorld(o.db, o.sceneId, input, carryOn),
    model: o.model,
    emit: o.emit,
    ...(o.quiet ? { quiet: true } : {}),
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    ...(o.retryDelays ? { retryDelays: o.retryDelays } : {})
  })
}
