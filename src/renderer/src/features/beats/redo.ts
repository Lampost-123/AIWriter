// What a beat's menu on the page does (2026-10-08; BeatMarksLayer.tsx shows the menu): write the beat again (with a
// note, or without), open what the AI saw for it, keep it as it is, or take it out. Owned by the Beat by beat part.
//
// - The session's last beat, while it ends the scene, is written again as the bar's Write it again does (flow.ts):
//   in its place, one Ctrl+Z takes the new version out.
// - Any other beat (an earlier one, or any beat after Finish) is written again as a tracked change in its place
//   (features/edits: the old words struck through, the new ones beside them, Accept or Reject), carrying on from
//   the text before it ("so far": none of the beats after it) and leading into what comes after it (the next beat,
//   quoted). Nothing in the text changes until Accept, which is one undo step, kept in History first (snapshot),
//   and makes the new version the beat's (its paragraphs and record). One draft job per scene: nothing else writes
//   into the scene while it is written.
// - Once an earlier beat changes, the beats after it say they were written before it changed (marks.ts), and can
//   be written again one at a time, or all of them in order (each a tracked change of its own).
// - Taking a beat out keeps the scene in History first, then takes its paragraphs out as one undo step.

import type { Node as PMNode } from '@tiptap/pm/model'
import type { AppEvents } from '@shared/api'
import type { SoFarEnd } from '@shared/contracts/beats'
import type { ID } from '@shared/types'
import { cardLength } from '@shared/defaults'
import { closeHistory } from '@tiptap/pm/history'
import { toast } from '@/components/ui'
import { api, type ApiError, modKey, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { snapshotBefore } from '@/features/history/snapshot'
import { resolveDraftOptions } from '@/features/generate/draftOptions'
import { busyElsewhere } from '@/features/generate/draftRun'
import { WORDS_META } from '@/features/goals/wordsMeta'
import { repairLanded } from '@/features/repair/repairRun'
import { cleanReply } from '@/features/edits/text'
import { dropReplacement, showReplacement, updateReplacement, waitingSuggestion } from '@/features/edits/session'
import { beatBeingWritten, recount, writeAgainFromPage } from './flow'
import { beatOf, beatSig, beatsShown, keptAsIs, paragraphsOf, withPids, withVersion, writtenBefore } from './marks'
import { changeMarks, installMarks, loadMarks, marksOf } from './marksStore'
import { patchSession, useBeats } from './session'
import {
  afterText,
  beatRange,
  endsWithBeat,
  pidsBetween,
  recordOf,
  removeParagraphs,
  soFarText,
  withOwner,
  withParagraphs,
  type BeatParagraphs
} from './sessionLogic'

const BUSY = 'A draft is being written into this scene. Stop it first, or wait for it to finish.'
const NOT_OPEN = 'Open this scene in the editor to write into it.'

/** A beat being written again as a tracked change. */
interface Redo {
  sceneId: ID
  index: number
  /** The tracked change in the page. */
  changeId: ID
  generationId: ID | null
  raw: string
  /** Words that arrived before startBeat returned the beat's id, and its end if that came too. */
  early: AppEvents['generation:chunk'][]
  earlyDone: AppEvents['generation:done'] | null
  /** Stopped or gone before its words began. */
  cancelled: boolean
  ended: boolean
}

let redo: Redo | null = null

/** "Redo all of them, in order": the beats still to write again after the one being written, on its scene. */
let queue: { sceneId: ID; rest: number[] } | null = null

const openSettings = (): void => useApp.getState().navigate({ kind: 'settings', tab: 'models' })

/** True while a beat of this scene is being written again as a tracked change. */
export const redoing = (sceneId: ID): number | null => (redo && redo.sceneId === sceneId && !redo.ended ? redo.index : null)

/**
 * Writes beat `index` of the scene again, following `note` if there is one: in the bar's way for the session's
 * last beat, else as a tracked change in place (see the top of this file).
 */
export async function redoBeat(sceneId: ID, index: number, note = '', o: { tracked?: boolean } = {}): Promise<void> {
  install()
  /** It can't be written now: says why, and "all in order" stops here. */
  const refuse = (message?: string, o?: Parameters<typeof toast>[1]): void => {
    queue = null
    if (message) toast(message, o)
  }
  const bridge = editorBridge()
  if (!bridge?.editor || bridge.sceneId !== sceneId) return refuse(NOT_OPEN)
  const app = useApp.getState()
  if (!app.settings?.models.writer) {
    return refuse('Choose a writer model in Settings first, then write the beat again.', {
      action: { label: 'Open Settings', run: openSettings }
    })
  }
  const writing = beatBeingWritten(sceneId) ?? redoing(sceneId)
  if (writing != null) return refuse(`Beat ${writing} is being written. Wait for it to finish, or stop it first.`)
  if (bridge.busy() || app.activeGeneration?.sceneId === sceneId) return refuse(BUSY)
  if (busyElsewhere(sceneId)) return refuse()
  if (!o.tracked && writeAgainFromPage(sceneId, index, note.trim())) return refuse()

  const marks = await loadMarks(sceneId)
  const ed = editorBridge()?.sceneId === sceneId ? editorBridge()?.editor : null
  if (!ed) return refuse(NOT_OPEN)
  const beat = beatOf(marks, index)
  const doc = ed.state.doc
  const range = beat && marks ? beatRange(doc, beat.pids) : null
  if (!marks || !beat || !range) return refuse(`Beat ${index} isn't on the page any more.`)
  const beats = paragraphsOf(marks)
  const soFar = soFarText(doc, marks.mode, beats, index)
  const soFarEnds = soFar ? howSoFarEnds(doc, beats, index) : undefined
  const after = afterText(doc, beat.pids)
  const steer = note.trim()

  const r: Redo = {
    sceneId,
    index,
    changeId: '',
    generationId: null,
    raw: '',
    early: [],
    earlyDone: null,
    cancelled: false,
    ended: false
  }
  const changeId = showReplacement({
    from: range.from,
    to: range.to,
    text: '',
    status: 'starting',
    working: `Writing beat ${index} again`,
    label: `Beat ${index}, written again`,
    snapshot: `Before beat ${index} was written again`,
    stop: () => stopRedo(r),
    onGone: (reason) => gone(r, reason),
    onAccepted: (words) => accepted(r, words)
  })
  if (!changeId) {
    queue = null
    return
  }
  r.changeId = changeId
  redo = r
  try {
    // The card and the page are saved first, so the beat is written from the latest of both.
    await flushAll()
    const card = (await api.getScene(sceneId)).card
    const now = useApp.getState()
    const options = resolveDraftOptions(now.draftOptions[sceneId], cardLength(card), now.settings?.creativity ?? 'balanced')
    if (r.cancelled) return
    const { generationId, of } = await api.startBeat({ sceneId, sessionId: marks.sessionId, index, options, steer, soFar, soFarEnds, after })
    if (r.cancelled || redo !== r) {
      void api.stopGeneration(generationId).catch(() => undefined)
      return
    }
    r.generationId = generationId
    updateReplacement(changeId, { status: 'writing', generationId })
    if (of !== marks.of) changeMarks(sceneId, (m) => (m ? { ...m, of } : m))
    for (const c of r.early) if (c.generationId === generationId) words(r, c.text)
    r.early = []
    if (r.earlyDone?.generationId === generationId) done(r, r.earlyDone)
  } catch (e) {
    if (r.cancelled) return
    r.ended = true
    if (redo === r) redo = null
    queue = null
    dropReplacement(changeId)
    const err = e as ApiError
    if (err.code === 'cancelled') return
    const settings = err.code === 'no-key' || err.code === 'no-writer-model' || /\bSettings\b/.test(err.message)
    toast(err.message, { tone: 'danger', action: settings ? { label: 'Open Settings', run: openSettings } : undefined })
  }
}

/** How the text before beat `index` ends: with the beat before it as written (or stopped part-way), or with Adam's own words. */
function howSoFarEnds(doc: PMNode, beats: BeatParagraphs, index: number): SoFarEnd {
  if (!endsWithBeat(doc, beats, index, index)) return 'after-beat'
  const s = useBeats.getState().session
  const before = s ? recordOf(doc, beats[index - 1] ?? [], s.owners) : null
  return before && s?.partWay.includes(before) ? 'mid-beat' : 'with-beat'
}

/** Stop (or Esc, or Reject while it is written): the beat stops; what came waits for Accept or Reject. */
function stopRedo(r: Redo): void {
  if (r.ended) return
  if (!r.generationId) {
    r.cancelled = true
    r.ended = true
    if (redo === r) redo = null
    void api.cancelBeatStart(r.sceneId).catch(() => undefined)
    return
  }
  void api.stopGeneration(r.generationId).catch(() => undefined)
}

/**
 * The tracked change went without Accept (rejected, its words edited, another scene...): the beat stops if it is
 * still being written, and nothing more comes of it. Rejected while "all in order" goes on: on to the next beat.
 */
function gone(r: Redo, reason: string): void {
  if (!r.ended) stopRedo(r)
  r.cancelled = true
  r.ended = true
  if (redo === r) redo = null
  if (reason === 'rejected' && queue?.sceneId === r.sceneId) return void next(r.sceneId)
  queue = null
}

function words(r: Redo, text: string): void {
  r.raw += text
  if (!updateReplacement(r.changeId, { text: cleanReply(r.raw, false), status: 'writing', retrying: false })) r.ended = true
}

function done(r: Redo, p: AppEvents['generation:done']): void {
  r.ended = true
  if (redo === r) redo = null
  const text = cleanReply(r.raw, true)
  if (!text.trim()) {
    dropReplacement(r.changeId)
    queue = null
    if (p.status === 'error') toast(p.error ?? 'Something went wrong while the beat was written. Try again.', { tone: 'danger' })
    else if (p.status === 'complete') toast(`The AI didn't write anything for beat ${r.index}. Try again.`)
    else toast('Stopped. Nothing in the text was changed.')
    return
  }
  const notes: string[] = []
  if (p.status === 'stopped') notes.push('Stopped before the end: these are the words that came.')
  if (p.status === 'error') notes.push(`The AI stopped part-way. ${p.error ?? ''}`.trim())
  if (p.cutOff) notes.push('The AI ran out of room before the end, so the new words may stop short.')
  updateReplacement(r.changeId, { text, status: 'ready', retrying: false, note: notes.join(' ') || null })
}

/** Accept: the new version is the beat's now (its paragraphs and record); the beats after it say if they were written before it. */
function accepted(r: Redo, at: { from: number; to: number }): void {
  const ed = editorBridge()?.sceneId === r.sceneId ? editorBridge()?.editor : null
  const recordId = r.generationId
  if (!ed || !recordId) return
  const doc = ed.state.doc
  const pids = pidsBetween(doc, at.from, at.to)
  changeMarks(r.sceneId, (m) => {
    if (!m) return m
    const withNew = withPids(m, r.index, pids)
    const all = beatOf(withNew, r.index)?.pids ?? pids
    return withVersion(withNew, r.index, { recordId, at: Date.now(), sig: beatSig(doc, all) })
  })
  // While writing beat by beat, the bar knows the beat's new paragraphs too.
  const s = useBeats.getState().session
  if (s?.sceneId === r.sceneId) {
    patchSession({ paragraphs: withParagraphs(s.paragraphs, r.index, pids), owners: withOwner(s.owners, pids, recordId) })
    recount()
  }
  // Check and repair: the new words are checked claim by claim as they go in, slips mended in amber.
  repairLanded({ sceneId: r.sceneId, recordId, from: at.from, to: at.to })
  if (queue?.sceneId === r.sceneId) return void next(r.sceneId)
  const later = writtenBefore(beatsShown(doc, marksOf(r.sceneId)), r.index)
  if (!later.length) return
  const one = later.length === 1
  const which = one ? `Beat ${later[0]} was` : `Beats ${listed(later)} were`
  toast(`${which} written before beat ${r.index} changed. You can keep ${one ? 'it' : 'them'}, or write ${one ? 'it' : 'them'} again.`, {
    action: { label: later.length === 1 ? 'Redo it' : 'Redo them in order', run: () => void redoAfter(r.sceneId, r.index, 'all') }
  })
}

const listed = (ns: number[]): string => (ns.length < 2 ? String(ns[0] ?? '') : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`)

/** "All of them, in order": the next beat in the queue, once the page has settled. */
function next(sceneId: ID): void {
  const q = queue
  const n = q?.sceneId === sceneId ? q.rest[0] : undefined
  if (!q || n == null) {
    queue = null
    return
  }
  queue = { sceneId, rest: q.rest.slice(1) }
  requestAnimationFrame(() => void redoBeat(sceneId, n, '', { tracked: true }))
}

/**
 * "Redo the beats after this": the beats after `index` written before a beat before them changed, the next one
 * ('next') or all of them in order ('all'), each as a tracked change of its own.
 */
export async function redoAfter(sceneId: ID, index: number, how: 'next' | 'all'): Promise<void> {
  const ed = editorBridge()?.sceneId === sceneId ? editorBridge()?.editor : null
  if (!ed) return void toast(NOT_OPEN)
  const later = writtenBefore(beatsShown(ed.state.doc, await loadMarks(sceneId)), index)
  if (!later.length) return void toast(`The beats after beat ${index} are as they were written.`)
  queue = how === 'all' && later.length > 1 ? { sceneId, rest: later.slice(1) } : null
  await redoBeat(sceneId, later[0], '', { tracked: true })
}

/** "Keep it as it is": a beat written before an earlier one changed stays, and its note goes. */
export function keepBeat(sceneId: ID, index: number): void {
  changeMarks(sceneId, (m) => (m ? keptAsIs(m, index, Date.now()) : m))
}

/** What the AI saw for the version of the beat on the page. */
export function showBeatRecord(recordId: ID | null): void {
  if (recordId) useApp.getState().navigate({ kind: 'generation', generationId: recordId })
}

/**
 * Takes the beat's paragraphs out of the page: the scene is kept in History first, then they come out as one
 * undo step (Ctrl+Z puts them back, and with them the beat's marker).
 */
export async function removeBeat(sceneId: ID, index: number): Promise<void> {
  const bridge = editorBridge()
  if (!bridge?.editor || bridge.sceneId !== sceneId) return void toast(NOT_OPEN)
  const writing = beatBeingWritten(sceneId) ?? redoing(sceneId)
  if (writing != null) return void toast(`Beat ${writing} is being written. Wait for it to finish, or stop it first.`)
  if (bridge.busy()) return void toast(BUSY)
  if (waitingSuggestion()) return void toast('Accept or reject the AI’s waiting change first.')
  const beat = beatOf(await loadMarks(sceneId), index)
  if (!beat) return
  await snapshotBefore(sceneId, `Before beat ${index} was taken out`)
  const ed = editorBridge()?.sceneId === sceneId ? editorBridge()?.editor : null
  if (!ed || ed.isDestroyed) return
  const tr = removeParagraphs(ed.state, beat.pids)
  if (!tr) return void toast(`Beat ${index} isn't on the page any more.`)
  // Writing by hand: the beat's words come off the AI words kept today.
  ed.view.dispatch(tr.setMeta(WORDS_META, 'ai-net'))
  ed.view.dispatch(closeHistory(ed.state.tr))
  toast(`Beat ${index} is taken out. ${modKey()}+Z puts it back.`, {
    action: { label: 'Undo', run: () => void editorBridge()?.undo() }
  })
}

let installed = false

/** Hears the beats' words as they are written again. Once, on first use. */
function install(): void {
  if (installed) return
  installed = true
  installMarks()
  onEvent('generation:chunk', (p) => {
    const r = redo
    if (!r || r.cancelled || r.ended) return
    if (r.generationId === null) {
      if (p.sceneId === r.sceneId) r.early.push(p)
      return
    }
    if (p.generationId === r.generationId) words(r, p.text)
  })
  onEvent('generation:retrying', (p) => {
    const r = redo
    if (r?.generationId && p.generationId === r.generationId) updateReplacement(r.changeId, { retrying: true })
  })
  onEvent('generation:done', (p) => {
    const r = redo
    if (!r || r.cancelled) return
    if (r.generationId === null) {
      if (p.sceneId === r.sceneId) r.earlyDone = p
    } else if (p.generationId === r.generationId) done(r, p)
  })
}
