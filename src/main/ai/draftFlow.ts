// Getting a draft's briefing ready, in one place: the writer model's checks, the memory catching up with
// earlier scenes first, the briefing fitted to the writer model, and the "too long" checks, all in plain
// words. Generate uses it, and so do milestone 4's Variants and Beat by beat, with their own closing
// instruction and (for a beat) the scene so far. Works on the open world and the app's settings.

import type { ContextPreview, DraftOptions, ID, ModelChoice, ThinkingLevel } from '@shared/types'
import { UserError } from '../util'
import * as world from '../world'
import { getSettings, getWritingPrefs } from '../settings'
import * as providers from './providers'
import type { ChatTarget } from './client'
import {
  cachedCounter,
  finishContext,
  lengthTooLong,
  prepareContext,
  sentEntryVersions,
  sentOrderOf,
  type ContextExtras,
  type ContextInput,
  type PreparedContext
} from './context'
import { carryOnFrom, catchUpBeforeDraft, gatherContextInput, stageNote, stageWhere, standAtText } from './gather'
import { keptStateBefore, type SceneState } from '../continuity/tracker'
import { memoryReady } from '../keeper'
import { planBeforeWriting, planWanted } from '../plan'
import { keepsRoom, type BeatAt } from '../plan/plan'
import { countTokens } from './tokenService'
import { isLocalUrl, providerWho } from './errors'
import { recallForBriefing } from '../retrieval'
import { contractWanted, type ContractAsks, type SceneContract } from './contract'
import { BRIEF_BLOCK, briefWanted, readBriefText } from './brief'
import * as gens from '../db/generations'
import { contractAgain, type ContractAsked } from './contractAgain'

/** The preview is made again as Adam edits the scene card: only the blocks that changed are counted again. */
const countCached = cachedCounter(countTokens)

/** The writer model and how to reach it, or a plain-words UserError saying what to set up in Settings › Models. */
export function writerModel(): { choice: ModelChoice; target: ChatTarget & { id: ID }; thinking: ThinkingLevel } {
  const settings = getSettings()
  const choice = settings.models.writer
  if (!choice) throw new UserError('Choose a writer model first, in Settings › Models.', 'no-writer-model')
  const provider = providers.getProvider(choice.providerId)
  if (!provider)
    throw new UserError("The writer model's provider has been removed. Choose a writer model in Settings › Models.", 'no-writer-model')
  const target = providers.providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    throw new UserError(`${providerWho(provider)} needs an API key. Add it in Settings › Models.`, 'no-key')
  }
  return { choice, target, thinking: settings.thinking?.writer ?? 'off' }
}

/**
 * What the scene's contract is for (long story memory fix 13): a beat (`focus`, the beat being written), a stretch
 * carried on from the scene so far (Add below), or the whole scene; null when Settings › Models turns contracts off.
 */
export function contractFor(options: Partial<DraftOptions> | undefined, focus?: string): { asks: ContractAsks; focus?: string } | null {
  if (!contractWanted(getSettings())) return null
  if (focus?.trim()) return { asks: 'beat', focus: focus.trim() }
  return { asks: options?.addBelow ? 'stretch' : 'scene' }
}

/**
 * Assembles the briefing for a scene with the current writer model's context length. `stand`: where things stand at
 * the end of the scene so far, for a draft that carries on from it (in place of where the previous scene ended).
 * `signal`: the draft's Stop (step 5's search stops with it). `focus`: for Beat by beat, the beat being written (the
 * scene's contract asks for that beat alone). `carryOn`: the scene so far the draft carries on from (Add below, a later
 * beat): what the memory read from it counts (gatherContextInput), and without a `stand` for its end nothing of where
 * things stood before it is told.
 */
export async function assemble(
  sceneId: ID,
  options: Partial<DraftOptions> | undefined,
  extras?: ContextExtras,
  stand?: SceneState | null,
  signal?: AbortSignal,
  focus?: string,
  carryOn?: string
): Promise<{ input: ContextInput; preview: ContextPreview; prepared: PreparedContext }> {
  const settings = getSettings()
  const db = world.db()
  const input = gatherContextInput(db, sceneId, options, {
    prefs: getWritingPrefs(),
    contextLength: settings.models.writer?.contextLength ?? null,
    maxOutput: settings.models.writer?.maxOutput ?? null,
    creativity: settings.creativity,
    ...(carryOn?.trim() ? { soFar: carryOn } : {})
  })
  // The scene's contract (fix 13): what the draft is asked to write; Add below only when it carries on from words.
  input.contract = contractFor(input.options, focus)
  // Carrying on: where things stand at the end of the scene so far, or (not worked out in time) nothing of it.
  if (stand || carryOn?.trim()) carryOnFrom(db, input, stand ?? null)
  // The scene so far a draft carries on from (Add below, a later beat): the items it names come into the briefing, and
  // first in what must stay true.
  const soFar = (extras?.extraBlocks ?? []).map((b) => b.text).join('\n\n')
  if (soFar.trim()) input.soFar = soFar
  // Story memory step 5 (src/main/retrieval/): entries of the last two scenes, what was said word for word, and what a
  // search for what the scene is about finds. Only candidates: the fitting below still keeps to the budget.
  input.recall = await recallForBriefing(db, sceneId, input, soFar, signal)
  return { input, ...(await fitted(input, extras)) }
}

/**
 * The order each scene's "Also relevant" and "Also in mind" were last sent in (context.ts keptOrder), so the next step of
 * the scene lists the same entries in the same order, new ones after, and a provider can reuse more of the prompt. Kept
 * in memory only, for the scenes briefed most recently.
 */
const sentOrders = new Map<ID, Record<string, ID[]>>()
const MOST_SENT_ORDERS = 20

/** The briefing from what it is made of, fitted to the writer model. */
async function fitted(input: ContextInput, extras?: ContextExtras): Promise<{ preview: ContextPreview; prepared: PreparedContext }> {
  // With reading aloud on, the writer says who speaks each line and how as it writes (ai/speakerTags.ts). Only the
  // dialogue: asked for the narration's mood as well, writers tagged a fifth fewer lines (live checks, 4 October 2026).
  const speech = getSettings().speech
  const sceneId = input.memory.sceneId
  input.sentOrder = sentOrders.get(sceneId)
  const prepared = prepareContext(input, { ...extras, speakerTags: !!(speech?.readAloud || speech?.showSpeakers) })
  sentOrders.delete(sceneId)
  sentOrders.set(sceneId, sentOrderOf(prepared.blocks))
  for (const old of [...sentOrders.keys()].slice(0, Math.max(0, sentOrders.size - MOST_SENT_ORDERS))) sentOrders.delete(old)
  const counts = await countCached(prepared.texts)
  return { preview: finishContext(prepared, counts), prepared }
}

/** Adam stopped the draft before it began: nothing more is done or sent. */
export const stoppedBeforeStart = (): UserError => new UserError('The draft was stopped before it began.', 'cancelled')

export interface DraftBriefing {
  input: ContextInput
  preview: ContextPreview
  choice: ModelChoice
  target: ChatTarget & { id: ID }
  thinking: ThinkingLevel
  /** The version of each entry actually sent, for "What the AI saw". */
  entryVersions: Map<ID, string>
  /**
   * What the briefing was fitted from (its closing instructions, the scene's contract, and its parts, for how much going
   * short beside a continuity brief frees: plan/brief.ts briefFrees), for planning it (withPlan).
   */
  prepared?: Pick<PreparedContext, 'finals' | 'contract'> & Partial<Pick<PreparedContext, 'blocks'>>
  /**
   * The scene's contract the writer was given (long story memory fix 13), for the check as the draft lands
   * (repair/index.ts noteContract) and the chapter writer's checks; null or left out: none (switched off, or nothing to say).
   */
  contract?: SceneContract | null
  /** Something Adam should know about how the draft was briefed, in plain words (gather.ts stageNote); null: nothing. */
  note?: string | null
}

/**
 * Everything a draft needs before it is sent. Earlier scenes the memory hasn't read yet are read first,
 * so the briefing is up to date (spec, Memory upkeep): this never waits long, a failure drafts with what
 * the memory has, and `signal` ends the wait at once (then this fails with the code 'cancelled').
 * `catchUp: false` skips that (a later beat of the same draft, say, right after the first); `catchUpMs` waits less than
 * usual (ai/gather.ts CATCH_UP_LIMIT_MS: until it has caught up), as Variants do.
 * `soFar`: the draft carries on from these words already in the scene (Add below, a later beat), so where things
 * stand at their end is worked out first (never for long) and told in place of where the previous scene ended.
 * `plan` (on unless false; Beat by beat plans the scene itself with withPlan, once a scene): the memory model plans
 * the scene first, with one round of look-ups, when Settings › Models says to (plan/), never for long (withPlan). A set of
 * Variants is briefed once, so its drafts share the one plan.
 * `brief: false`: the plan writes no continuity brief (Write the whole chapter, whose study wrote one; plan/index.ts).
 */
export async function draftBriefing(
  sceneId: ID,
  options: Partial<DraftOptions> | undefined,
  o: {
    extras?: ContextExtras
    signal?: AbortSignal
    catchUp?: boolean
    catchUpMs?: number
    soFar?: string
    plan?: boolean
    focus?: string
    brief?: boolean
  } = {}
): Promise<DraftBriefing> {
  const { choice, target, thinking } = writerModel()
  const db = world.db()
  if (o.catchUp !== false) await catchUpBeforeDraft(db, sceneId, o.catchUpMs, o.signal)
  if (o.signal?.aborted) throw stoppedBeforeStart()
  const carryOn = o.soFar?.trim() ? o.soFar : ''
  const stand = carryOn ? await standAtText(db, sceneId, carryOn, undefined, o.signal) : null
  if (o.signal?.aborted) throw stoppedBeforeStart()
  if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the draft could start.')
  const made = await assemble(sceneId, options, o.extras, stand, o.signal, o.focus, carryOn)
  if (o.signal?.aborted) throw stoppedBeforeStart()
  if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the draft could start.')
  let b: DraftBriefing = {
    ...made,
    choice,
    target,
    thinking,
    entryVersions: sentEntryVersions(made.input.memory, made.preview.blocks),
    contract: made.prepared.contract ?? null
  }
  if (o.plan !== false) b = await withPlan(sceneId, b, { extras: o.extras, signal: o.signal, brief: o.brief })
  // Where things stand as the previous scene ended goes on being worked out after the draft's wait, so it is looked up
  // again now (review, 2026-10-16): one that came in during the plan's own wait (up to two minutes) is told after all.
  if (!carryOn && !b.input.continuity) b = await withStageNow(sceneId, b, o.extras)
  b = { ...b, note: stageNote(b.input, { soFar: !!carryOn, memoryReady: memoryReady() }) }
  const { input, preview } = b
  // A model whose window is known can't take a reply longer than what's left of it: say so
  // before sending, rather than letting the provider turn it down with a message about the briefing.
  const tooLong = choice.contextLength != null && choice.contextLength > 0 ? lengthTooLong(preview.budget) : null
  if (tooLong) {
    if (tooLong.maxWords >= 100 && input.options.targetWords == null) {
      // Auto came down as far as it goes (AUTO_LENGTH.min) and still doesn't fit: a set length can.
      throw new UserError(
        `This model can write about ${tooLong.maxWords.toLocaleString('en-GB')} words in one go, less than Auto needs. Set a length in the draft options or on the scene card, or pick a model that can read more in Settings › Models.`,
        'too-long'
      )
    }
    if (tooLong.maxWords >= 100) {
      throw new UserError(
        `This model can write about ${tooLong.maxWords.toLocaleString('en-GB')} words in one go. Lower the length in the draft options or on the scene card, or pick a model that can read more in Settings › Models.`,
        'too-long'
      )
    }
    throw new UserError(
      "This model can't read the style guide and the scene card and still write the scene. Pick a model that can read more in Settings › Models, or shorten the scene card or the style guide.",
      'briefing-too-long'
    )
  }
  return b
}

/**
 * A whole scene's contract made again from what its draft was asked for, with the memory and where things stand as they
 * are now (ai/contractAgain.ts), on the open world with the app's settings: the chapter writer checks each scene through
 * it. Null when contracts are off or it would say nothing.
 */
export function contractNow(sceneId: ID, asked: ContractAsked): SceneContract | null {
  const settings = getSettings()
  return contractAgain(world.db(), sceneId, asked, {
    prefs: getWritingPrefs(),
    contextLength: settings.models.writer?.contextLength ?? null,
    maxOutput: settings.models.writer?.maxOutput ?? null,
    creativity: settings.creativity,
    wanted: contractWanted(settings)
  })
}

/**
 * The briefing again with where things stand as the previous scene ended, when it is kept by now (the stage read went on
 * after the draft's wait); as it was otherwise. The plan, its brief and what it said must change stay; the scene's
 * contract is made again, with what must be true at the start.
 */
async function withStageNow(sceneId: ID, b: DraftBriefing, extras?: ContextExtras): Promise<DraftBriefing> {
  const db = world.db()
  const stand = keptStateBefore(db, sceneId)
  if (!stand) return b
  const input: ContextInput = { ...b.input, continuity: stand, stageWhere: stageWhere(db, stand) }
  const again = await fitted(input, extras)
  return {
    ...b,
    input,
    preview: again.preview,
    prepared: again.prepared,
    entryVersions: sentEntryVersions(input.memory, again.preview.blocks),
    contract: again.prepared.contract ?? null
  }
}

/**
 * Plan before writing (step 4, plan/; done properly in the overhaul, 2026-10-19): when Settings › Models says to, the
 * memory model plans the scene, with one round of look-ups answered on this computer, never for long; the entries it asks
 * for (or reads) come into the briefing, what it looked up goes in beside the plan, and the plan goes in after the closing
 * instruction as the writer's own notes. `beat`: Beat by beat, the beat being written: one plan for the scene, made with
 * its first beat and given to the later ones (plan/index.ts). Only when there is room: with what it asked for and what
 * it looked up, else without one then the other, else no plan, never at the cost of anything the briefing had room for
 * without it (keepsRoom). Otherwise the briefing comes back as it was.
 */
export async function withPlan(
  sceneId: ID,
  b: DraftBriefing,
  o: { extras?: ContextExtras; signal?: AbortSignal; beat?: BeatAt; brief?: boolean } = {}
): Promise<DraftBriefing> {
  if (!b.prepared) return b
  const db = world.db()
  const plan = await planBeforeWriting(db, sceneId, { input: b.input, preview: b.preview, prepared: b.prepared }, o.signal, {
    brief: o.brief,
    ...(o.beat ? { beat: o.beat } : {})
  })
  if (o.signal?.aborted) throw stoppedBeforeStart()
  if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the draft could start.')
  if (!plan) return b
  // With what it asked for and what it looked up, else without what it looked up, then without what it asked for; with
  // the continuity brief (fix 14), else without it. Each only if it says anything.
  const looked = plan.lookedUp ?? ''
  const briefs = plan.brief ? [plan.brief, null] : [null]
  const tries = briefs
    .flatMap((brief) => [
      { ...plan, brief, lookedUp: looked },
      ...(looked ? [{ ...plan, brief, lookedUp: '' }] : []),
      ...(plan.needs.length && plan.text ? [{ ...plan, needs: [], brief, lookedUp: looked }, ...(looked ? [{ ...plan, needs: [], brief, lookedUp: '' }] : [])] : [])
    ])
    .filter((p) => p.text || p.needs.length || p.must.length || p.brief)
  for (const p of tries) {
    const input: ContextInput = {
      ...b.input,
      plan: { needs: p.needs, text: p.text, ...(p.lookedUp ? { lookedUp: p.lookedUp } : {}) },
      ...(p.brief ? { brief: p.brief } : {})
    }
    // What the plan says must change takes the place of the card's own words in the scene's contract (fix 13).
    if (b.input.contract && p.must.length) input.contract = { ...b.input.contract, planned: p.must }
    const again = await fitted(input, o.extras)
    if (keepsRoom(b.preview, again.preview)) {
      return {
        ...b,
        input,
        preview: again.preview,
        prepared: again.prepared,
        entryVersions: sentEntryVersions(input.memory, again.preview.blocks),
        contract: again.prepared.contract ?? null
      }
    }
  }
  return b
}

/**
 * The briefing for the Context tab: as a draft would have it before its plan, and, while drafts get a continuity brief
 * (fix 14), with the last brief written for this scene (from its newest draft that had one) where it goes in, so the tab
 * shows the brief and the parts that go short beside it. The next draft writes a new one.
 */
export async function previewBriefing(sceneId: ID, options: Partial<DraftOptions> | undefined): Promise<ContextPreview> {
  const made = await assemble(sceneId, options)
  if (!planWanted() || !briefWanted(getSettings())) return made.preview
  const brief = readBriefText(gens.lastSentBlock(world.db(), sceneId, BRIEF_BLOCK.id))
  if (!brief) return made.preview
  const again = await fitted({ ...made.input, brief })
  return keepsRoom(made.preview, again.preview) ? again.preview : made.preview
}

/** Provider bookkeeping every draft does: a key turned down shows in Settings; a provider that writes works again. */
export function providerNotes(providerId: ID): { onKeyRejected: () => void; onWorked: () => void } {
  return {
    onKeyRejected: () => providers.markCheck(providerId, false),
    onWorked: () => {
      if (providers.getProvider(providerId)?.lastCheck?.ok === false) providers.markCheck(providerId, true)
    }
  }
}
