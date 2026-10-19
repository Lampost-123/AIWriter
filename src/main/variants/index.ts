// Variants (milestone 4): 2 or 3 drafts of a scene written side by side, from one briefing. The memory
// catches up with earlier scenes and the briefing is made once for the whole set (draftFlow's
// draftBriefing, passed in); then every variant is a 'draft' record of its own (params.variant
// { setId, index, of }), written by the shared draft runner (startDraftJob with exclusive: false), so it
// streams as 'generation:chunk' events and can be stopped on its own (stopDraft) or with its set.
//
// Nothing goes into the scene here: the variants are only records until Adam picks one in the
// interface, and the memory never reads them (the memory keeper reads the scene's own text, and the
// briefing of a later scene reads the scenes, never draft records). No Electron imports: the caller
// passes the database, the briefing and the events.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextBlock, DraftOptions, ID } from '@shared/types'
import type { StartVariantsInput, VariantSet, VariantsStarted } from '@shared/contracts/variants'
import { UserError } from '../util'
import { activeDraftIds, isDrafting, startDraftJob, stopDraft, type Emit } from '../ai/drafts'
import type { DraftBriefing } from '../ai/draftFlow'
import type { WriterSpeaker } from '../ai/speakerTags'
import { latestVariantRows } from '../db/variants'

type DB = Database.Database

/** Said when the scene already has a set of variants being written. */
export const SET_BUSY = 'Variants of this scene are already being written. Stop them first, or wait for them to finish.'
/** Said when a draft of the scene (Generate, Beat by beat) is being written. */
export const DRAFT_BUSY = 'A draft is being written for this scene. Stop it first, or wait for it to finish, then write the variants.'
/** Said to Generate (or Beat by beat) while the scene's variants are getting ready or being written. */
export const VARIANTS_WRITING = 'Variants of this scene are being written. Stop them on the Variants page, or wait for them to finish.'

/** The longest note a variant takes of its own (the direction box's limit). */
const NOTE_MAX = 2000

/** Each variant's own direction, tidied: one for each of `count`, '' for none. */
export function variantNotes(notes: unknown, count: number): string[] {
  const list = Array.isArray(notes) ? notes : []
  return Array.from({ length: count }, (_, i) => {
    const note = list[i]
    return typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : ''
  })
}

/**
 * The set's briefing with one variant's own direction ("Draft three: tense / tender / funny"), said last before the plan
 * the set shares (the writer's own notes, which the prose carries on from), or last of all when there is no plan. The
 * start of the briefing is the same for every variant, so the later ones still read it from the provider's cache.
 */
export function withVariantNote(messages: ChatMessage[], blocks: ContextBlock[], note: string): ChatMessage[] {
  if (!note) return messages
  const at = messages.map((m) => m.role).lastIndexOf('user')
  if (at < 0) return messages
  const line = `For this version of the scene, as the author asks: ${note}`
  const content = messages[at].content
  const plan = blocks.find((b) => b.id === 'plan' && !b.dropped)?.text ?? ''
  const next =
    plan && content.endsWith(plan) ? `${content.slice(0, content.length - plan.length)}${line}\n\n${plan}` : `${content}\n\n${line}`
  return messages.map((m, i) => (i === at ? { ...m, content: next } : m))
}

/** The set was called off before anything was sent. */
const calledOff = (): UserError => new UserError('The variants were stopped before they began.', 'cancelled')

/** A set started this session: getting ready (no drafts yet), then being written. */
interface RunningSet {
  setId: ID
  sceneId: ID
  /** Ends the wait while the set gets ready (the memory catching up, the briefing being made). */
  stop: AbortController
  /** Its drafts, in order, once started. */
  ids: ID[]
  starting: boolean
}

const sets = new Map<ID, RunningSet>()

/** True while the set is getting ready or any of its variants is being written. */
function busy(set: RunningSet): boolean {
  if (set.starting) return true
  const live = new Set(activeDraftIds())
  return set.ids.some((id) => live.has(id))
}

/** Forgets sets that have ended: their records hold everything about them. */
function prune(): void {
  for (const [id, set] of sets) if (!busy(set)) sets.delete(id)
}

/** True while a set of this scene's variants is getting ready or being written. */
export function variantsBusy(sceneId: ID): boolean {
  return [...sets.values()].some((s) => s.sceneId === sceneId && busy(s))
}

export interface VariantsDeps {
  db: DB
  emit: Emit
  /** The scene's briefing, made once for the set: the memory catches up first (draftFlow.draftBriefing). */
  briefing(sceneId: ID, options: DraftOptions, signal: AbortSignal): Promise<DraftBriefing>
  /** True while a draft of the scene is being started elsewhere (Generate, waiting for the memory). */
  startingElsewhere?(sceneId: ID): boolean
  /** The provider bookkeeping every draft does (draftFlow.providerNotes). */
  providerNotes?(providerId: ID): { onKeyRejected: () => void; onWorked: () => void }
  /** Who the writer said says each line of a variant, kept until it goes into the scene (readAloud). */
  onSpeakers?(generationId: ID, speakers: WriterSpeaker[]): void
  /** For tests. */
  retryDelays?: number[]
}

/**
 * Starts a set of 2 or 3 variants of a scene, side by side: one briefing, then one draft per variant,
 * each writing in the background. Resolves with their ids once they have all started. Refused in plain
 * words while the scene has a draft or another set being written; fails with the code 'cancelled' when
 * stopVariantSet called it off while it was getting ready (nothing was sent).
 */
export async function startVariantSet(input: StartVariantsInput, deps: VariantsDeps): Promise<VariantsStarted> {
  const { setId, sceneId, count, options } = input
  if (typeof setId !== 'string' || !setId || typeof sceneId !== 'string' || !sceneId) {
    throw new UserError('Something went wrong starting the variants. Try again.')
  }
  if (count !== 2 && count !== 3) throw new UserError('Variants are written two or three at a time.')
  prune()
  if (sets.has(setId)) throw new UserError('These variants have already been started.')
  if (variantsBusy(sceneId)) throw new UserError(SET_BUSY, 'busy')
  if (isDrafting(sceneId) || deps.startingElsewhere?.(sceneId)) throw new UserError(DRAFT_BUSY, 'busy')

  const set: RunningSet = { setId, sceneId, stop: new AbortController(), ids: [], starting: true }
  sets.set(setId, set)
  try {
    const b = await deps.briefing(sceneId, options, set.stop.signal)
    if (set.stop.signal.aborted) throw calledOff()
    // A draft of the scene began, or began getting ready, while the set got ready (Generate, say): the
    // scene is its for now. (Generate waits for the set, so this is only in case something else didn't.)
    if (isDrafting(sceneId) || deps.startingElsewhere?.(sceneId)) throw new UserError(DRAFT_BUSY, 'busy')
    const notes = deps.providerNotes?.(b.target.id)
    const own = variantNotes(input.notes, count)
    for (let index = 1; index <= count; index++) {
      const note = own[index - 1]
      const { generationId } = startDraftJob({
        db: deps.db,
        sceneId,
        job: 'draft',
        partOf: { variant: { setId, index, of: count, ...(note ? { note } : {}) } },
        // The set's drafts are written side by side.
        exclusive: false,
        options: b.input.options,
        // Each variant's own direction, if it has one, is said after the set's.
        preview: note ? { ...b.preview, messages: withVariantNote(b.preview.messages, b.preview.blocks, note) } : b.preview,
        provider: b.target,
        model: b.choice,
        thinking: b.thinking,
        intensity: b.input.style.intensity,
        entryVersions: b.entryVersions,
        emit: deps.emit,
        onKeyRejected: notes?.onKeyRejected,
        onWorked: notes?.onWorked,
        onSpeakers: (speakers, id) => deps.onSpeakers?.(id, speakers),
        retryDelays: deps.retryDelays
      })
      set.ids.push(generationId)
    }
    return { setId, generationIds: [...set.ids] }
  } catch (e) {
    // Any variant already started (only if the runner failed part-way) stops, keeping its record.
    for (const id of set.ids) void stopDraft(id).catch(() => undefined)
    if (!set.ids.length) sets.delete(setId)
    throw e
  } finally {
    set.starting = false
  }
}

/**
 * Stops a set: getting ready, it is called off (nothing is sent); being written, every variant still
 * writing stops, keeping what arrived. Resolves once their records are finished.
 */
export async function stopVariantSet(setId: ID): Promise<void> {
  const set = sets.get(setId)
  if (!set) return
  set.stop.abort()
  await Promise.all(set.ids.map((id) => stopDraft(id).catch((e) => console.warn('Could not stop a variant', e))))
}

/** The scene's latest set of variants, read from their records, or null when it has none. */
export function latestVariantSet(db: DB, sceneId: ID): VariantSet | null {
  const rows = latestVariantRows(db, sceneId)
  if (!rows.length) return null
  const live = new Set(activeDraftIds())
  const first = rows[0]
  return {
    setId: first.setId,
    sceneId,
    of: Math.max(first.of, rows.length),
    createdAt: first.createdAt,
    direction: first.direction,
    targetWords: first.targetWords,
    creativity: first.creativity,
    variants: rows.map((r) => ({
      generationId: r.id,
      index: r.index,
      // A record still marked as being written by a draft that has ended can't be written to any more.
      status: r.status === 'streaming' && !live.has(r.id) ? 'stopped' : r.status,
      text: r.response,
      error: r.status === 'error' ? r.error : null,
      cost: r.cost,
      costEstimated: r.cost != null && r.promptTokens == null,
      cutOff: r.cutOff,
      modelId: r.modelId,
      ...(r.note ? { note: r.note } : {})
    }))
  }
}

/** For tests: forget every set (as a fresh start would). */
export const resetVariantsForTests = (): void => sets.clear()
