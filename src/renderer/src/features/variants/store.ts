// The variants of each scene, kept while the app is open: the set being written (its text arriving as
// 'generation:chunk' events, one draft per variant) or the scene's last set read back from its records,
// and the paragraphs Adam has picked from it. Leaving the page (or the scene) leaves a set writing, and it
// is here when he comes back; when it ends while he is elsewhere, a message says so. Another world forgets
// them all (its drafts stop as it closes).

import { create } from 'zustand'
import type { AppEvents } from '@shared/api'
import type { Creativity, DraftOptions, GenerationStatus, ID } from '@shared/types'
import type { VariantCount, VariantSet } from '@shared/contracts/variants'
import { toast } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { openScene } from '@/features/memory/openScene'
import { togglePick, type Pick } from './merge'

export interface LiveVariant {
  /** Its draft; empty while the set is getting ready. */
  generationId: ID
  /** Which variant it is, from 1. */
  index: number
  status: GenerationStatus
  /** Its text as the model wrote it, so far while it is being written. */
  text: string
  /** Plain words with a next step, when it ended with a problem. */
  error: string | null
  cost: number | null
  costEstimated: boolean
  /** It ran into the reply limit, so it stops before the scene's end. */
  cutOff: boolean
  modelId: string
  /** Why it is waiting to try again (a busy provider), until its next words arrive. */
  retrying: string | null
  /** Stop was pressed: its last words are on their way. */
  stopping: boolean
}

export interface LiveSet {
  setId: ID
  sceneId: ID
  /** Getting ready: the memory catching up with earlier scenes, then the briefing being made. */
  starting: boolean
  /** Stop all was pressed. */
  stopping: boolean
  /** Started in this session (not read back from the records). */
  live: boolean
  createdAt: string
  direction: string
  targetWords: number | null
  creativity: Creativity | null
  variants: LiveVariant[]
  /** The paragraphs picked so far, in the order they will go into the scene. */
  picks: Pick[]
}

/** A scene's variants: being looked up, none yet, its latest set, or the lookup failed. */
export type SceneVariants = { kind: 'loading' } | { kind: 'none' } | { kind: 'set'; set: LiveSet } | { kind: 'failed'; error: string }

/** Why the variants didn't start, in plain words, and where the fix is. */
export interface StartProblem {
  message: string
  fix: 'settings' | 'length' | null
}

interface VariantsState {
  scenes: Record<ID, SceneVariants>
  /** The last failed start of each scene's variants, shown where they are started until the next try. */
  problems: Record<ID, StartProblem | null>
}

export const useVariants = create<VariantsState>(() => ({ scenes: {}, problems: {} }))

const get = useVariants.getState
const setScene = (sceneId: ID, entry: SceneVariants): void => useVariants.setState((s) => ({ scenes: { ...s.scenes, [sceneId]: entry } }))
const setProblem = (sceneId: ID, problem: StartProblem | null): void =>
  useVariants.setState((s) => ({ problems: { ...s.problems, [sceneId]: problem } }))

/** The scene's set, if it has one on screen. */
export const setOf = (s: VariantsState, sceneId: ID): LiveSet | null => {
  const e = s.scenes[sceneId]
  return e?.kind === 'set' ? e.set : null
}

/** True while the set is getting ready or any of its variants is being written. */
export const isWriting = (set: LiveSet | null | undefined): boolean =>
  !!set && (set.starting || set.variants.some((v) => v.status === 'streaming'))

/** Changes the scene's set, if it is still this one. */
function updateSet(sceneId: ID, setId: ID, fn: (s: LiveSet) => LiveSet): void {
  const e = get().scenes[sceneId]
  if (e?.kind !== 'set' || e.set.setId !== setId) return
  setScene(sceneId, { kind: 'set', set: fn(e.set) })
}

const blankVariant = (index: number): LiveVariant => ({
  generationId: '',
  index,
  status: 'streaming',
  text: '',
  error: null,
  cost: null,
  costEstimated: false,
  cutOff: false,
  modelId: '',
  retrying: null,
  stopping: false
})

/** A set read back from its records. */
function fromRecords(v: VariantSet): LiveSet {
  return {
    setId: v.setId,
    sceneId: v.sceneId,
    starting: false,
    stopping: false,
    live: false,
    createdAt: v.createdAt,
    direction: v.direction,
    targetWords: v.targetWords,
    creativity: v.creativity,
    variants: v.variants.map((x) => ({ ...x, retrying: null, stopping: false })),
    picks: []
  }
}

/** A fresh id for a set (any unique string will do). */
function newSetId(): ID {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Adam is looking at this scene's variants right now. */
const onPage = (sceneId: ID): boolean => {
  const v = useApp.getState().view
  return v.kind === 'variants' && v.sceneId === sceneId
}

const sceneTitle = (sceneId: ID): string | null =>
  useOutlineStore
    .getState()
    .outline?.scenes.find((s) => s.id === sceneId)
    ?.title.trim() || null

/** The scene's variants, with the scene open in the editor beneath them (so one can go into it). */
async function showVariants(sceneId: ID): Promise<void> {
  if (useApp.getState().sceneId !== sceneId) await openScene(sceneId)
  if (useApp.getState().sceneId === sceneId) useApp.getState().navigate({ kind: 'variants', sceneId })
}
const showThem = (sceneId: ID) => ({ label: 'Show them', run: () => void showVariants(sceneId) })
const openSettings = { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) }

// ---------- Following the drafts ----------

/** Which scene and set each running draft belongs to. */
const owners = new Map<ID, { sceneId: ID; setId: ID }>()
/** Sets getting ready, by scene: their drafts' first events can arrive before their ids are known. */
const startingFor = new Map<ID, ID>()
type DraftEvent =
  | { name: 'chunk'; p: AppEvents['generation:chunk'] }
  | { name: 'retrying'; p: AppEvents['generation:retrying'] & { sceneId?: ID } }
  | { name: 'done'; p: AppEvents['generation:done'] }
const early = new Map<ID, DraftEvent[]>()

/** Text waiting to go on screen, by draft: it goes on once a frame, however often it arrives. */
const pending = new Map<ID, string>()
let frame = 0
let backup: ReturnType<typeof setTimeout> | undefined

function queueText(generationId: ID, text: string): void {
  pending.set(generationId, (pending.get(generationId) ?? '') + text)
  if (frame) return
  frame = requestAnimationFrame(flushText)
  // A window in the background gets no frames: its text still goes on, more slowly.
  backup = setTimeout(flushText, 250)
}

function flushText(): void {
  if (frame) cancelAnimationFrame(frame)
  clearTimeout(backup)
  frame = 0
  if (!pending.size) return
  const batch = new Map(pending)
  pending.clear()
  const scenes = { ...get().scenes }
  let changed = false
  for (const [sceneId, entry] of Object.entries(scenes)) {
    if (entry.kind !== 'set' || !entry.set.variants.some((v) => batch.has(v.generationId))) continue
    const variants = entry.set.variants.map((v) => {
      const more = batch.get(v.generationId)
      return more ? { ...v, text: v.text + more, retrying: null } : v
    })
    scenes[sceneId] = { kind: 'set', set: { ...entry.set, variants } }
    changed = true
  }
  if (changed) useVariants.setState({ scenes })
}

function apply(ev: DraftEvent): void {
  const owner = owners.get(ev.p.generationId)
  if (!owner) {
    // A draft of a set getting ready: kept until its id is known.
    const sceneId = 'sceneId' in ev.p ? ev.p.sceneId : undefined
    const setId = sceneId ? startingFor.get(sceneId) : undefined
    if (setId) early.get(setId)?.push(ev)
    return
  }
  if (ev.name === 'chunk') {
    queueText(ev.p.generationId, ev.p.text)
    return
  }
  if (ev.name === 'retrying') {
    const reason = ev.p.reason
    updateSet(owner.sceneId, owner.setId, (s) => ({
      ...s,
      variants: s.variants.map((v) => (v.generationId === ev.p.generationId ? { ...v, retrying: reason } : v))
    }))
    return
  }
  // Done: its last words first.
  flushText()
  const p = ev.p
  owners.delete(p.generationId)
  updateSet(owner.sceneId, owner.setId, (s) => ({
    ...s,
    variants: s.variants.map((v) =>
      v.generationId === p.generationId
        ? {
            ...v,
            status: p.status,
            error: p.status === 'error' ? (p.error ?? 'Something went wrong while this variant was written.') : null,
            cost: p.cost,
            costEstimated: p.cost != null && p.promptTokens == null,
            cutOff: !!p.cutOff,
            retrying: null,
            stopping: false
          }
        : v
    )
  }))
  const set = setOf(get(), owner.sceneId)
  if (set?.setId === owner.setId && !isWriting(set)) ended(set)
}

/** The whole set has ended: its text checked against the records, and a word for Adam if he is elsewhere. */
function ended(set: LiveSet): void {
  const { sceneId, setId } = set
  // Anything missed on the way (there shouldn't be) is in the records.
  api
    .getVariantSet(sceneId)
    .then((saved) => {
      if (!saved || saved.setId !== setId) return
      updateSet(sceneId, setId, (s) => {
        const changed = new Set<ID>()
        const variants = s.variants.map((v) => {
          const r = saved.variants.find((x) => x.generationId === v.generationId)
          if (!r) return v
          if (r.text !== v.text) changed.add(v.generationId)
          return { ...v, text: r.text, modelId: r.modelId }
        })
        // A paragraph picked from text that has changed may not be the same paragraph any more.
        return { ...s, variants, picks: changed.size ? s.picks.filter((p) => !changed.has(p.generationId)) : s.picks }
      })
    })
    .catch(() => undefined)
  if (onPage(sceneId) || !set.live) return
  const title = sceneTitle(sceneId)
  const of = title ? ` of “${title}”` : ''
  const failed = set.variants.find((v) => v.status === 'error' && v.error)
  if (failed?.error) {
    toast(`The variants${of} couldn't all be written. ${failed.error}`, {
      tone: 'danger',
      action: /\bSettings\b/.test(failed.error) ? openSettings : showThem(sceneId)
    })
  } else if (!set.stopping && set.variants.some((v) => v.status === 'complete')) {
    toast(`The variants${of} are written.`, { action: showThem(sceneId) })
  }
}

let listening = false
let epoch = 0

/** Follows the drafts' events (once, for as long as the app is open). */
export function ensureListening(): void {
  if (listening) return
  listening = true
  onEvent('generation:chunk', (p) => apply({ name: 'chunk', p }))
  onEvent('generation:retrying', (p) => apply({ name: 'retrying', p }))
  onEvent('generation:done', (p) => apply({ name: 'done', p }))
  // Another world: none of this one's variants apply.
  useApp.subscribe((s, prev) => {
    if (s.world?.id === prev.world?.id) return
    epoch++
    owners.clear()
    startingFor.clear()
    early.clear()
    pending.clear()
    useVariants.setState({ scenes: {}, problems: {} })
  })
}

// ---------- What the page does ----------

/** Reads the scene's last set from its records, unless it is known already (or `force`). */
export async function loadVariants(sceneId: ID, force = false): Promise<void> {
  ensureListening()
  const now = get().scenes[sceneId]
  if (now && now.kind !== 'failed' && !force) return
  if (!now || now.kind === 'failed') setScene(sceneId, { kind: 'loading' })
  const mine = epoch
  try {
    const saved = await api.getVariantSet(sceneId)
    if (mine !== epoch) return
    const cur = get().scenes[sceneId]
    // A set started meanwhile is newer than anything read.
    if (cur?.kind === 'set' && cur.set.live) return
    if (saved) {
      // Still being written (the window was reloaded meanwhile): its next words and its end come as events.
      for (const v of saved.variants) if (v.status === 'streaming') owners.set(v.generationId, { sceneId, setId: saved.setId })
    }
    setScene(sceneId, saved ? { kind: 'set', set: fromRecords(saved) } : { kind: 'none' })
  } catch (e) {
    if (mine === epoch && get().scenes[sceneId]?.kind === 'loading') setScene(sceneId, { kind: 'failed', error: plainReason(e) })
  }
}

/** What to say, and where the fix is, when the variants couldn't start. */
function problemOf(err: ApiError): StartProblem {
  const message = plainReason(err)
  if (err.code === 'too-long') return { message, fix: 'length' }
  if (err.code === 'no-writer-model' || err.code === 'no-key' || /\bSettings\b/.test(message)) return { message, fix: 'settings' }
  return { message, fix: null }
}

/**
 * Starts a set of variants of the scene with these options: its columns show at once (getting ready
 * while the memory catches up and the briefing is made), then each fills as its draft is written.
 * Resolves with what happened; a failed start puts back what the scene had and keeps the problem
 * (see `problems`) for the page to show.
 */
export async function startVariants(sceneId: ID, count: VariantCount, options: DraftOptions): Promise<'started' | 'cancelled' | 'failed'> {
  ensureListening()
  const before = get().scenes[sceneId]
  if (before?.kind === 'set' && isWriting(before.set)) return 'failed'
  const setId = newSetId()
  const set: LiveSet = {
    setId,
    sceneId,
    starting: true,
    stopping: false,
    live: true,
    createdAt: new Date().toISOString(),
    direction: options.direction,
    targetWords: options.targetWords,
    creativity: options.creativity,
    variants: Array.from({ length: count }, (_, i) => blankVariant(i + 1)),
    picks: []
  }
  startingFor.set(sceneId, setId)
  early.set(setId, [])
  setScene(sceneId, { kind: 'set', set })
  setProblem(sceneId, null)
  const mine = epoch
  try {
    const { generationIds } = await api.startVariants({ setId, sceneId, count, options })
    if (mine !== epoch) return 'cancelled'
    for (const id of generationIds) owners.set(id, { sceneId, setId })
    updateSet(sceneId, setId, (s) => ({
      ...s,
      starting: false,
      variants: s.variants.slice(0, generationIds.length).map((v, i) => ({ ...v, generationId: generationIds[i], stopping: s.stopping }))
    }))
    // What arrived before the ids were known, in the order it came.
    const waiting = early.get(setId) ?? []
    early.delete(setId)
    startingFor.delete(sceneId)
    for (const ev of waiting) apply(ev)
    return 'started'
  } catch (e) {
    if (mine !== epoch) return 'cancelled'
    early.delete(setId)
    if (startingFor.get(sceneId) === setId) startingFor.delete(sceneId)
    // The scene shows what it had before (its last set, or none).
    const cur = get().scenes[sceneId]
    if (cur?.kind === 'set' && cur.set.setId === setId) setScene(sceneId, before && before.kind === 'set' ? before : { kind: 'none' })
    const err = e instanceof ApiError ? e : new ApiError(plainReason(e))
    // Stopped before it began: nothing was sent, and there's nothing to say.
    if (err.code === 'cancelled') return 'cancelled'
    const problem = problemOf(err)
    setProblem(sceneId, problem)
    if (!onPage(sceneId)) {
      toast(`The variants couldn't start. ${problem.message}`, {
        tone: 'danger',
        action: problem.fix === 'settings' ? openSettings : showThem(sceneId)
      })
    }
    return 'failed'
  }
}

/** Stops one variant; what it wrote so far is kept. */
export function stopVariant(sceneId: ID, generationId: ID): void {
  const set = setOf(get(), sceneId)
  const v = set?.variants.find((x) => x.generationId === generationId)
  if (!set || !v || v.status !== 'streaming' || v.stopping) return
  const mark = (stopping: boolean): void =>
    updateSet(sceneId, set.setId, (s) => ({
      ...s,
      variants: s.variants.map((x) => (x.generationId === generationId ? { ...x, stopping } : x))
    }))
  mark(true)
  api.stopGeneration(generationId).catch((e: unknown) => {
    mark(false)
    toast(`That variant couldn't be stopped. ${plainReason(e)}`, { tone: 'danger' })
  })
}

/** Stops the whole set: one getting ready is called off (nothing is sent); what was written is kept. */
export function stopAll(sceneId: ID): void {
  const set = setOf(get(), sceneId)
  if (!set || !isWriting(set) || set.stopping) return
  updateSet(sceneId, set.setId, (s) => ({
    ...s,
    stopping: true,
    variants: s.variants.map((v) => (v.status === 'streaming' ? { ...v, stopping: true } : v))
  }))
  api.stopVariants(set.setId).catch((e: unknown) => {
    updateSet(sceneId, set.setId, (s) => ({ ...s, stopping: false, variants: s.variants.map((v) => ({ ...v, stopping: false })) }))
    toast(`The variants couldn't be stopped. ${plainReason(e)}`, { tone: 'danger' })
  })
}

/** Picks a paragraph of a variant, or unpicks it. */
export function pickParagraph(sceneId: ID, pick: Pick): void {
  const set = setOf(get(), sceneId)
  if (set) updateSet(sceneId, set.setId, (s) => ({ ...s, picks: togglePick(s.picks, pick) }))
}

export function clearPicks(sceneId: ID): void {
  const set = setOf(get(), sceneId)
  if (set?.picks.length) updateSet(sceneId, set.setId, (s) => ({ ...s, picks: [] }))
}

/** Forgets why the last start failed (Adam changed something, or is trying again). */
export const clearProblem = (sceneId: ID): void => {
  if (get().problems[sceneId]) setProblem(sceneId, null)
}
