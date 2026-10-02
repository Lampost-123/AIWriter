// Beat by beat's working parts (milestone 4): starting a session on a scene, writing one beat of its
// card at a time into the page through the editor bridge (as Generate writes a draft), pausing between
// beats, Write it again, Stop and Finish. The session is kept in session.ts; the bar (BeatBar.tsx) and
// the toolbar button (BeatsButton.tsx) show it; sessionLogic.ts reads the page.
//
// How the rest of the app meets a session (decided here):
// - Another page (Settings, What the AI saw, Variants...): the beat being written carries on, as
//   Generate's drafts do, and the session waits. Coming back shows the bar as it was.
// - Another scene: the beat being written stops there (the editor says so, as for Generate's drafts)
//   and the session waits on its scene. Coming back shows the bar, ready for the next beat.
// - Generate on the scene: a new draft of the whole scene, so the session ends (the beats stay).
// - Variants: written on their own page, so the session waits (no beat can start while they are
//   being written: the scene has drafts being written). Picking one puts a whole draft in place of the
//   scene's text, and the session ends as for Generate; so does anything else that replaces the whole
//   scene at once and takes the beats with it (a restored snapshot, say).
// - Switching worlds ends it.

import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { closeHistory, isHistoryTransaction, redo, redoNoScroll, undoDepth, undoNoScroll } from '@tiptap/pm/history'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { AppEvents } from '@shared/api'
import type { SoFarEnd } from '@shared/contracts/beats'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { api, ApiError, modKey, onEvent } from '@/lib/api'
import { editorBridge, type EditorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { isShortcut, shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { activeStream, streamKey } from '@/features/editor/streamDoc'
import { resolveDraftOptions } from '@/features/generate/draftOptions'
import { snapshotBefore } from '@/features/history/snapshot'
import { revealCardPart } from '@/features/palette/cardReveal'
import { focusBar, patchSession, useBeats, type BeatQuestion, type BeatSession } from './session'
import {
  beatsOnPage,
  cardBeats,
  endsPage,
  endsWithBeat,
  isWholePage,
  markPage,
  nextBeat,
  pidsFrom,
  recordOf,
  removeParagraphs,
  soFarText,
  startOf,
  unchangedSince,
  withOwner,
  withParagraphs,
  type BeatMode,
  type PageMark
} from './sessionLogic'

const BUSY = 'A draft is being written into this scene. Stop it first, or wait for it to finish.'
const NOT_OPEN = 'Open this scene in the editor to write into it.'

/** A beat being written, or getting ready. */
interface Run {
  sceneId: ID
  index: number
  again: boolean
  /** It takes the place of the page's text: Replace it, or a beat written again that was all there was on the page. */
  replace: boolean
  /** The page shows nothing of its own when it ends (the bar does): every beat but Replace it's first, whose message has Undo. */
  quiet: boolean
  /** Writing again: the paragraphs of the beat as it was, and the record of that version. */
  old: string[]
  oldRecord: ID | null
  /** Writing again: the beat as it was has made way for the new words (they go in its place). */
  settled: boolean
  /** It was undone: the new version is the only undo step, as for any beat. */
  undone: boolean
  /** It was taken out as an undo step of its own (Adam had changed the page since it was written). */
  removed: boolean
  /** Writing again: blank lines that arrived before the first words, held until the beat as it was makes way. */
  held: string
  generationId: ID | null
  /** Words that arrived before startBeat returned the beat's id. */
  early: AppEvents['generation:chunk'][]
  earlyDone: AppEvents['generation:done'] | null
  cancelled: boolean
  /** Some of the beat's words reached the page. */
  wrote: boolean
  /** The page's undo steps when it began (or once the beat as it was made way): any above are Adam's own changes since. */
  depth: number
  /** Adam has changed the page himself since it began, so redo reaches only his own changes (see undoMidBeat). */
  own: boolean
}

let run: Run | null = null

/** The page as each beat's record left it (so Write it again knows whether the beat is still the newest undo step). */
const marks = new Map<ID, PageMark>()

/** The last message about a beat (a problem, a cut-off), taken away when the next beat starts. */
let beatToast: number | null = null

/** A scene whose beats are being looked up, so a second press doesn't ask twice. */
let opening: ID | null = null

const openSettings = (): void => useApp.getState().navigate({ kind: 'settings', tab: 'models' })

/** Something else (a menu, a dialog, a popover) is open and should get Esc first. */
const layerOpen = (): boolean => !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')

/** The key was pressed in the manuscript page. */
const inPage = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.ProseMirror')

/** The key was pressed in the bar, but not in its box with a note typed in it (Ctrl+Z there undoes the typing). */
const inBarNotTyping = (t: EventTarget | null): boolean =>
  t instanceof Element && !!t.closest('[data-beat-bar]') && !(t instanceof HTMLTextAreaElement && t.value !== '')

/**
 * Undo pressed here reaches the page: in the page itself, or on the writing page with nothing else open,
 * in the bar (not in its box with a note typed), on Generate's buttons, or with the keyboard nowhere in particular.
 */
function reachesPage(t: EventTarget | null): boolean {
  if (inPage(t)) return true
  if (useApp.getState().view.kind !== 'write' || layerOpen()) return false
  if (!t || t === document.body || t === document.documentElement) return true
  return inBarNotTyping(t) || (t instanceof Element && !!t.closest('[data-generate-controls]'))
}

/** Undo (Ctrl+Z) or redo (Ctrl+Y, or Ctrl+Shift+Z) as the page takes them, or null for any other key. */
function historyKeyOf(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return null
  const key = e.key.toLowerCase()
  if (key === 'z' || key === 'я') return e.shiftKey ? 'redo' : 'undo'
  return key === 'y' && !e.shiftKey ? 'redo' : null
}

/** The key is dealt with here: nothing else (the page included) acts on it. */
function swallow(e: Event): void {
  e.preventDefault()
  e.stopImmediatePropagation()
}

// ---------- Starting ----------

/**
 * Starts Beat by beat on the open scene (the toolbar button, the palette). On a scene with text it
 * first asks whether the beats replace it or go below it, as Generate does; with no beats on the scene
 * card, or no writer model, it says so instead. Already on for this scene: the bar's box gets the
 * keyboard. `byKey`: asked from the keyboard, so the answer that has the keyboard shows it.
 */
export async function openBeats(sceneId: ID, byKey: boolean): Promise<void> {
  install()
  const s = useBeats.getState().session
  if (s?.sceneId === sceneId) {
    if (s.phase === 'paused') focusBar()
    return
  }
  const app = useApp.getState()
  if (!app.settings?.models.writer) return ask({ sceneId, kind: 'need-model', byKey, from: 'button', beats: [] })
  const bridge = editorBridge()
  if (!bridge || bridge.sceneId !== sceneId) return void toast(NOT_OPEN)
  if (bridge.busy() || app.activeGeneration?.sceneId === sceneId) return void toast(BUSY)
  if (opening === sceneId) return
  opening = sceneId
  let beats: string[]
  try {
    // The card's latest beats are saved first.
    await flushAll()
    beats = cardBeats((await api.getScene(sceneId)).card.beats)
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
    return
  } finally {
    opening = null
  }
  // Gone to another scene in the meantime.
  if (useApp.getState().sceneId !== sceneId || editorBridge()?.sceneId !== sceneId) return
  if (!beats.length) return ask({ sceneId, kind: 'no-beats', byKey, from: 'button', beats })
  if (editorBridge()?.hasText()) return ask({ sceneId, kind: 'choose', byKey, from: 'button', beats })
  begin(sceneId, 'whole', beats, false)
}

const ask = (question: BeatQuestion): void => useBeats.setState({ question })

/** Closes a question without answering it. */
export const dismissQuestion = (): void => useBeats.setState({ question: null })

/** "This scene already has text": the beats take its place, or go below it. */
export function answer(choice: 'replace' | 'add'): void {
  const q = useBeats.getState().question
  if (q?.kind !== 'choose') return
  useBeats.setState({ question: null })
  const bridge = editorBridge()
  if (!bridge || bridge.sceneId !== q.sceneId) return void toast(NOT_OPEN)
  // Emptied since the question was asked: there's nothing to replace.
  const filled = bridge.hasText()
  const replace = choice === 'replace' && filled
  const mode: BeatMode = choice === 'add' && filled ? 'below' : 'whole'
  const s = useBeats.getState().session
  if (q.from === 'bar' && s?.sceneId === q.sceneId) {
    patchSession({ mode })
    void writeBeat(1, { replace })
  } else begin(q.sceneId, mode, q.beats, replace)
  focusBar()
}

/** A new session on the scene (one at a time), writing its first beat straight away. */
function begin(sceneId: ID, mode: BeatMode, beats: string[], replace: boolean): void {
  const worldId = useApp.getState().world?.id
  if (!worldId) return
  if (useBeats.getState().session) end()
  useBeats.setState({
    session: {
      id: crypto.randomUUID(),
      worldId,
      sceneId,
      mode,
      paragraphs: {},
      owners: {},
      partWay: [],
      kept: false,
      written: 0,
      last: null,
      below: null,
      phase: 'paused',
      current: null,
      retrying: null,
      steer: '',
      beats
    },
    question: null
  })
  focusBar()
  void writeBeat(1, { replace })
}

// ---------- The bar's buttons ----------

/** Write the next beat (with the note in the box). The first beat on a page with text asks where it goes first. */
export function writeNext(byKey = false): void {
  const s = useBeats.getState().session
  if (!s || s.phase !== 'paused' || run) return
  const next = nextBeat(s.written, s.beats.length)
  if (next == null) return
  if (next === 1) {
    const bridge = editorBridge()
    if (bridge?.sceneId === s.sceneId && bridge.hasText())
      return ask({ sceneId: s.sceneId, kind: 'choose', byKey, from: 'bar', beats: s.beats })
    patchSession({ mode: 'whole' })
  }
  void writeBeat(next)
  focusBar()
}

/**
 * Write it again: the beat just written is undone and written afresh in its place, with the note in the
 * box (see makeWay). Only while it ends the scene: with Adam's own words after it, the new version
 * would land after them, so it says so instead.
 */
export function writeAgain(): void {
  const s = useBeats.getState().session
  if (!s || s.phase !== 'paused' || run || s.written < 1) return
  const ed = editorBridge()?.sceneId === s.sceneId ? editorBridge()?.editor : null
  if (ed && !endsPage(ed.state.doc, s.paragraphs[s.written] ?? [])) {
    toast(`Beat ${s.written} can only be written again while it ends the scene, and your own words come after it now.`)
    return
  }
  void writeBeat(s.written, { again: true })
  focusBar()
}

/** The record of the beat the bar is about (the last one on the page): what the AI saw for it. */
export function showRecord(): void {
  const id = useBeats.getState().session?.last
  if (id) useApp.getState().navigate({ kind: 'generation', generationId: id })
}

/** Stops the beat being written (the text so far stays), or calls off one still getting ready. */
export function stopBeat(): void {
  const r = run
  const s = useBeats.getState().session
  if (!r || !s) return
  if (!r.generationId) {
    // Still getting ready (perhaps the memory catching up first): called off, and nothing is sent.
    r.cancelled = true
    patchSession({ phase: 'stopping' })
    void api.cancelBeatStart(r.sceneId).catch(() => undefined)
    return
  }
  if (s.phase === 'stopping') return
  patchSession({ phase: 'stopping' })
  api.stopGeneration(r.generationId).catch((e: Error) => toast(e.message, { tone: 'danger' }))
}

/** Finish: the session ends and the beats stay as they are. The keyboard goes back into the page. */
export function finish(): void {
  end()
  requestAnimationFrame(() => editorBridge()?.takeKeyboard())
}

/** Ends the session (Finish, Generate, the whole scene replaced, another world). The text stays. */
export function end(): void {
  const r = run
  run = null
  if (r) {
    r.cancelled = true
    const bridge = editorBridge()
    if (r.generationId) {
      void api.stopGeneration(r.generationId).catch(() => undefined)
      if (bridge?.sceneId === r.sceneId) bridge.endStream(r.generationId)
      const app = useApp.getState()
      if (app.activeGeneration?.id === r.generationId) app.setActiveGeneration(null)
    } else {
      void api.cancelBeatStart(r.sceneId).catch(() => undefined)
      if (r.replace && bridge?.sceneId === r.sceneId) bridge.releaseHold()
    }
  }
  marks.clear()
  useBeats.setState({ session: null, question: null })
  settleHeight()
}

/** Opens the scene card in the scene panel at its beats, with the keyboard in the first one. */
export function openCardAtBeats(sceneId: ID): void {
  useBeats.setState({ question: null })
  const a = useApp.getState()
  if (a.view.kind !== 'write') a.navigate({ kind: 'write' })
  a.setInspectorTab('card')
  a.peekEntry(null)
  if (a.askOpen) a.setAskOpen(false)
  if (a.settings && !a.settings.layout.inspectorOpen) void a.updateSettings({ layout: { inspectorOpen: true } })
  revealCardPart(sceneId, 'beats')
  // Once the card shows (a few frames, as for the reveal): the caret goes into its first beat.
  const until = performance.now() + 3000
  let frames = 0
  const look = (): void => {
    if (useApp.getState().sceneId !== sceneId || performance.now() > until) return
    const label =
      ++frames > 2 ? [...document.querySelectorAll('[role="tabpanel"] label')].find((l) => l.textContent?.trim() === 'Beats') : null
    const box = label instanceof HTMLLabelElement && label.htmlFor ? document.getElementById(label.htmlFor) : null
    if (box instanceof HTMLTextAreaElement) {
      box.focus({ preventScroll: true })
      box.setSelectionRange(box.value.length, box.value.length)
    } else requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}

// ---------- Writing a beat ----------

async function writeBeat(index: number, how: { again?: boolean; replace?: boolean } = {}): Promise<void> {
  const s = useBeats.getState().session
  if (!s || s.phase !== 'paused' || run) return
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!bridge || !ed || bridge.sceneId !== s.sceneId) return void toast(NOT_OPEN)
  if (bridge.busy() || useApp.getState().activeGeneration?.sceneId === s.sceneId) return void toast(BUSY)
  const again = !!how.again
  const doc = ed.state.doc
  const old = again ? (s.paragraphs[index] ?? []) : []
  // Writing again a beat that is all there is on the page: the page is held as it is until the new
  // version's first words arrive, as for Replace it.
  const replace = !!how.replace || (again && isWholePage(doc, old))
  const steer = s.steer.trim()
  const soFar = index > 1 ? soFarText(doc, s.mode, s.paragraphs, again ? index : undefined) : ''
  const soFarEnds = soFar ? howSoFarEnds(s, doc, index, again) : undefined
  // Anything Adam types from here is an undo step of its own, so undo can tell his changes from the beat's (see undoMidBeat).
  ed.view.dispatch(closeHistory(ed.state.tr))
  // From now until the first words arrive, text about to be replaced is held as it is (as for Generate).
  if (replace && !bridge.holdForReplace(s.sceneId)) {
    toast("The editor wasn't ready for this scene, so nothing was sent. Try again in a moment.")
    return
  }
  const r: Run = {
    sceneId: s.sceneId,
    index,
    again,
    replace,
    // Replace it's first beat keeps Generate's message about the text it replaced, with its Undo.
    quiet: !(how.replace && !again),
    old,
    oldRecord: again ? recordOf(doc, old, s.owners) : null,
    settled: !again,
    undone: false,
    removed: false,
    held: '',
    generationId: null,
    early: [],
    earlyDone: null,
    cancelled: false,
    wrote: false,
    depth: undoDepth(ed.state),
    own: false
  }
  run = r
  dismissBeatToast()
  // The note goes with this beat; the box is ready for the next one.
  patchSession({ phase: 'starting', current: { index, generationId: null, again, steer }, steer: '', retrying: null, below: null })
  /** The beat didn't start: the page is as it was, and the note goes back in the box (unless a new one was typed meanwhile). */
  const giveUp = (): void => {
    if (run !== r) return
    run = null
    if (replace) bridge.releaseHold()
    patchSession((x) => ({ phase: 'paused', current: null, retrying: null, steer: x.steer.trim() ? x.steer : steer }))
  }
  try {
    // The scene as it was before the session's first words, kept in its History once. A session that
    // began on an empty page has nothing to keep: its first words mark it kept (see note).
    if (!s.kept && bridge.hasText()) {
      await snapshotBefore(s.sceneId, 'Before beat by beat')
      patchSession({ kept: true })
    }
    // The card and the page are saved first, so the beat is written from the latest of both.
    await flushAll()
    const card = (await api.getScene(s.sceneId)).card
    const app = useApp.getState()
    const options = resolveDraftOptions(app.draftOptions[s.sceneId], card.targetWords, app.settings?.creativity ?? 'balanced')
    if (r.cancelled) return giveUp()
    const { generationId, of } = await api.startBeat({ sceneId: s.sceneId, sessionId: s.id, index, options, steer, soFar, soFarEnds })
    if (r.cancelled || run !== r) {
      void api.stopGeneration(generationId).catch(() => undefined)
      giveUp()
      return
    }
    // Every beat after the first carries straight on, so the beats read as one piece. A beat written
    // again waits after the beat as it was until its first words arrive (see makeWay).
    if (!bridge.beginStream(s.sceneId, generationId, { replace, noBreak: !replace && (index > 1 || again), quiet: r.quiet })) {
      void api.stopGeneration(generationId).catch(() => undefined)
      giveUp()
      toast("The editor wasn't ready for this scene, so the beat was stopped. Try again in a moment.")
      return
    }
    r.generationId = generationId
    useApp.getState().setActiveGeneration({ id: generationId, sceneId: s.sceneId })
    patchSession((x) => ({ phase: 'writing', current: x.current ? { ...x.current, generationId } : null }))
    if (of !== s.beats.length) void reloadBeats(s.sceneId)
    if (!replace) keepInView()
    for (const c of r.early) if (c.generationId === generationId) append(r, c.text)
    r.early = []
    if (r.earlyDone?.generationId === generationId) finishBeat(r, r.earlyDone)
    else updatePointer()
  } catch (e) {
    const cancelled = r.cancelled
    giveUp()
    if (!cancelled) failedToStart(e as ApiError, s.sceneId)
  }
}

/**
 * How the scene so far that beat `index` carries on from ends: with the beat before it as written,
 * part-way through that beat (it was stopped or cut off), or with Adam's own words after it.
 */
function howSoFarEnds(s: BeatSession, doc: PMNode, index: number, again: boolean): SoFarEnd {
  if (!endsWithBeat(doc, s.paragraphs, index, again ? index : undefined)) return 'after-beat'
  const before = recordOf(doc, s.paragraphs[index - 1] ?? [], s.owners)
  return before && s.partWay.includes(before) ? 'mid-beat' : 'with-beat'
}

/** Takes away the last message about a beat (its problem is old news once the next beat starts). */
function dismissBeatToast(): void {
  if (beatToast != null) useToasts.getState().dismiss(beatToast)
  beatToast = null
}

/** Says why a beat couldn't start, with the way on. */
function failedToStart(err: ApiError, sceneId: ID): void {
  // Stopped before it began: nothing was sent, and there's nothing to say.
  if (err.code === 'cancelled') return
  const asked = { sceneId, byKey: false, from: 'bar' as const, beats: useBeats.getState().session?.beats ?? [] }
  if (err.code === 'no-writer-model') return ask({ ...asked, kind: 'need-model' })
  if (err.code === 'no-beats') {
    void reloadBeats(sceneId)
    return ask({ ...asked, kind: 'no-beats' })
  }
  if (err.code === 'no-such-beat') void reloadBeats(sceneId)
  const settings = err.code === 'no-key' || /\bSettings\b/.test(err.message)
  toast(err.message, { tone: 'danger', action: settings ? { label: 'Open Settings', run: openSettings } : undefined })
}

/** The beat's words into the page. */
function append(r: Run, text: string): void {
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!bridge || !ed || bridge.sceneId !== r.sceneId || !r.generationId) return
  if (!r.settled) {
    // Writing again: the beat as it was stays until the first words arrive (in case none come), then
    // makes way for them.
    if (!text.trim()) {
      r.held += text
      return
    }
    text = r.held + text
    r.held = ''
    if (!makeWay(r, bridge, ed)) return
  }
  bridge.appendStream(r.generationId, text)
  note(r)
  if (useBeats.getState().session?.retrying) patchSession({ retrying: null })
}

/**
 * Writing a beat again, as the new version's first words arrive: the beat as it was makes way. When the
 * page is as that beat left it, it is undone (as Ctrl+Z would), so the new version is the only undo
 * step: one Ctrl+Z takes it out like any beat, and the old version stays in its record. When Adam has
 * changed the page since, undoing would take his changes with it, so the beat's paragraphs are taken out
 * as a step of their own instead (Ctrl+Z takes the new version out, and pressed again brings the old one
 * back); a beat that was all there was on the page is replaced in one step, as Replace it does. False
 * when the new version couldn't start in its place (it is stopped, and the page stays as it was).
 */
function makeWay(r: Run, bridge: EditorBridge, ed: Editor): boolean {
  r.settled = true
  const id = r.generationId!
  if (unchangedSince(ed.state, r.oldRecord ? marks.get(r.oldRecord) : null)) {
    holdHeight(ed.view.dom)
    // Nothing of the new version is on the page yet, so ending its stream changes nothing. The page
    // stays where it is (an undo would otherwise show the caret, wherever that is).
    bridge.endStream(id)
    undoNoScroll(ed.state, ed.view.dispatch)
    // A first beat that had replaced the scene's text takes its place again; a first beat below the
    // old text goes under a scene break again.
    const replace = r.index === 1 && useBeats.getState().session?.mode === 'whole' && bridge.hasText()
    if (!bridge.beginStream(r.sceneId, id, { replace, noBreak: !replace && r.index > 1, quiet: true })) {
      redoNoScroll(ed.state, ed.view.dispatch)
      void api.stopGeneration(id).catch(() => undefined)
      return false
    }
    r.replace = replace
    r.undone = true
    r.depth = undoDepth(ed.state)
    r.own = false
    return true
  }
  if (!r.replace) {
    const tr = removeParagraphs(ed.state, r.old)
    if (tr) {
      holdHeight(ed.view.dom)
      ed.view.dispatch(tr)
      // Anything typed straight after is a step of its own.
      ed.view.dispatch(closeHistory(ed.state.tr))
      r.removed = true
      // Taking the beat as it was out is the new version's to undo, not one of Adam's changes.
      r.depth = undoDepth(ed.state)
      r.own = false
    }
  }
  return true
}

/** Remembers the paragraphs the beat has written so far, and that this record wrote them (so the page says how far the session has got). */
function note(r: Run): void {
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!ed || bridge?.sceneId !== r.sceneId || !r.generationId || !r.settled) return
  const info = activeStream(ed.state)
  if (!info || info.generationId !== r.generationId) return
  // Replacing, the old text is there until the first words arrive: none of it is the beat's.
  if (info.replace && !info.before) return
  const pids = pidsFrom(ed.state.doc, info.from)
  if (!pids.length) return
  r.wrote = true
  const s = useBeats.getState().session
  if (!s) return
  const paragraphs = withParagraphs(s.paragraphs, r.index, pids)
  const owners = withOwner(s.owners, pids, r.generationId)
  // The session's first words are on the page: from here, nothing before it is left to keep.
  if (paragraphs !== s.paragraphs || owners !== s.owners || !s.kept) patchSession({ paragraphs, owners, kept: true })
}

/** The beat has ended: the bar pauses for Adam's note, and a problem is said in one message (as for Generate). */
function finishBeat(r: Run, p: AppEvents['generation:done']): void {
  if (run !== r) return
  note(r)
  const failed = (p.status === 'error' && !!p.error) || !!p.cutOff
  const bridge = editorBridge()
  const { replaced } = bridge?.endStream(p.generationId, { failed }) ?? { replaced: false }
  run = null
  // The page as this beat left it, so Write it again can tell whether it is still the newest undo step.
  if (r.wrote && bridge?.sceneId === r.sceneId && bridge.editor) marks.set(p.generationId, markPage(bridge.editor.state))
  const app = useApp.getState()
  if (app.activeGeneration?.id === p.generationId) app.setActiveGeneration(null)
  // Stopped, cut off, or a problem after some of its words: the bar says the beat is unfinished.
  const partWay = r.wrote && (p.status !== 'complete' || !!p.cutOff)
  patchSession((x) => ({
    phase: 'paused',
    current: null,
    retrying: null,
    // A beat that brought no words: the note goes back in the box, unless a new one has been typed.
    steer: !r.wrote && !x.steer.trim() && x.current ? x.current.steer : x.steer,
    partWay: partWay ? [...x.partWay, p.generationId] : x.partWay,
    // A beat that finished out of sight below: the bar points to it until it has been seen.
    below: x.below?.writing && r.wrote ? { index: r.index, writing: false } : null
  }))
  recount()
  settleHeight()
  const seeRecord = {
    label: 'What the AI saw',
    run: () => useApp.getState().navigate({ kind: 'generation', generationId: p.generationId })
  }
  // What Ctrl+Z does now, where that isn't simply taking the beat out.
  const back = replaced
    ? r.again && !r.undone
      ? ` ${modKey()}+Z puts the beat back as it was.`
      : ` ${modKey()}+Z puts the scene's old text back.`
    : r.removed
      ? ` ${modKey()}+Z takes the new words out, and pressed again puts the beat back as it was.`
      : ''
  if (p.status === 'error' && p.error) {
    beatToast = toast(p.error + back, {
      tone: 'danger',
      action: /\bSettings\b/.test(p.error) ? { label: 'Open Settings', run: openSettings } : seeRecord
    })
  } else if (p.cutOff) {
    beatToast = toast(
      `The model ran out of room before the end of the beat, so it stops part-way. The text so far is kept. Write it again, or try a writer model that can write more in one go.${back}`,
      { action: seeRecord }
    )
  }
  // Ready for the next note, if the keyboard was in the bar (or nowhere in particular).
  const here = document.activeElement
  if (!here || here === document.body || here.closest('[data-beat-bar]')) focusBar()
}

// ---------- Undo while a beat is written ----------

/**
 * Undo or redo, while a beat is being written or getting ready, where it reaches the page. Adam's own
 * changes since the beat began undo and redo as usual. Past them, undo takes the beat out (see takeOut)
 * rather than reaching the beats before it while it writes, and redo brings back nothing from before
 * it. A beat taking the place of the page's text is the page's to take out, as for Generate's Replace
 * it. True when it was dealt with here (the page's own undo or redo mustn't run).
 */
function undoMidBeat(action: 'undo' | 'redo'): boolean {
  const r = run
  const bridge = editorBridge()
  const ed = r && !r.cancelled && bridge?.sceneId === r.sceneId ? bridge.editor : null
  if (!r || !ed) return false
  const info = activeStream(ed.state)
  // Replacing the page's text, or over (its words have stopped coming in) and only waiting to be told so.
  if (info?.replace || (r.generationId && info?.generationId !== r.generationId)) return false
  if (action === 'redo') return !r.own
  if (undoDepth(ed.state) > r.depth) return false
  takeOut(r)
  return true
}

/**
 * Ctrl+Z on a beat being written: it stops, and the words it has written so far come out in one step
 * (Ctrl+Y puts them back, and its record keeps them). The bar goes back to that beat, with its note back
 * in the box. A beat still getting ready is called off, as Stop does.
 */
function takeOut(r: Run): void {
  const bridge = editorBridge()
  const ed = bridge?.editor
  const id = r.generationId
  if (!id) return stopBeat()
  if (!bridge || !ed) return
  run = null
  r.cancelled = true
  void api.stopGeneration(id).catch(() => undefined)
  note(r)
  const depth = undoDepth(ed.state)
  bridge.endStream(id)
  const app = useApp.getState()
  if (app.activeGeneration?.id === id) app.setActiveGeneration(null)
  // Its words are one undo step now. The page as they left it is marked (for Write it again, once Ctrl+Y
  // puts them back), then they come out, and the page stays where it is.
  let out = false
  if (r.wrote && undoDepth(ed.state) > depth) {
    marks.set(id, markPage(ed.state))
    out = undoNoScroll(ed.state, ed.view.dispatch)
  }
  patchSession((x) => ({
    phase: 'paused',
    current: null,
    retrying: null,
    // None of the beat is on the page: its note goes back in the box, unless a new one has been typed.
    steer: (out || !r.wrote) && !x.steer.trim() && x.current ? x.current.steer : x.steer,
    // Put back, it shows as a beat that stopped part-way.
    partWay: r.wrote ? [...x.partWay, id] : x.partWay,
    below: null
  }))
  recount()
  settleHeight()
  if (out) {
    const before = r.removed ? ` Pressed again, ${shortcutText('undo')} puts the beat back as it was.` : ''
    beatToast = toast(`Beat ${r.index} stopped, and its words so far are taken out. ${shortcutText('redo')} puts them back.${before}`)
  }
  const here = document.activeElement
  if (!here || here === document.body || here.closest('[data-beat-bar]')) focusBar()
}

// ---------- Following the page ----------

/** Works out how many beats are on the page (after Ctrl+Z, redo, edits...), and which version of the last one shows. */
export function recount(): void {
  const s = useBeats.getState().session
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!s || !ed || bridge?.sceneId !== s.sceneId) return
  const doc = ed.state.doc
  const written = beatsOnPage(doc, s.paragraphs)
  const last = written ? recordOf(doc, s.paragraphs[written] ?? [], s.owners) : null
  if (written !== s.written || last !== s.last) patchSession({ written, last })
  updatePointer()
}

/** True when a place in the page is out of sight below: behind the bar, or further down. */
function isBelow(ed: Editor, pos: number): boolean {
  const bar = document.querySelector('[data-beat-bar]')
  if (!bar) return false
  try {
    const top = ed.view.coordsAtPos(Math.min(pos + 1, ed.state.doc.content.size)).top
    return top > bar.getBoundingClientRect().top - 8
  } catch {
    return false
  }
}

/** Where the beat the bar points to begins: the one being written, or the one that finished out of sight. */
function pointedAt(s: BeatSession, ed: Editor): number | null {
  if (!s.below) return null
  if (s.below.writing) {
    const info = activeStream(ed.state)
    // Replacing, the beat begins at the top of the page once its first words are in.
    return info && run?.generationId === info.generationId && !(info.replace && !info.before) ? info.from : null
  }
  return startOf(ed.state.doc, s.paragraphs[s.below.index] ?? [])
}

/**
 * Keeps the bar's pointer to a beat out of sight below up to date (the page's own "new draft below"
 * pointer would be under the bar): shown while the beat being written starts below what shows above
 * the bar, and after a beat that finished there until its start has been seen.
 */
function updatePointer(): void {
  const s = useBeats.getState().session
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!s || !ed || bridge?.sceneId !== s.sceneId || useApp.getState().view.kind !== 'write') return
  const writing = !!run?.generationId && s.phase !== 'paused' && run.sceneId === s.sceneId
  const asked = writing ? { index: run!.index, writing: true } : s.below?.writing ? null : s.below
  const pos = asked ? pointedAt({ ...s, below: asked }, ed) : null
  const below = asked && pos != null && isBelow(ed, pos) ? asked : null
  if (below?.index !== s.below?.index || below?.writing !== s.below?.writing) patchSession({ below })
}

/** The bar's pointer: the page glides to where the beat begins, a quarter of the way down (and follows it from there while it is written). */
export function revealBeat(): void {
  const s = useBeats.getState().session
  const ed = editorBridge()?.sceneId === s?.sceneId ? editorBridge()?.editor : null
  const scroller = ed ? scrollerOf(ed.view.dom) : null
  const pos = s && ed ? pointedAt(s, ed) : null
  if (!ed || !scroller || pos == null) return
  try {
    const top = ed.view.coordsAtPos(Math.min(pos + 1, ed.state.doc.content.size)).top
    const at = top - scroller.getBoundingClientRect().top + scroller.scrollTop
    glide(scroller, Math.min(at - scroller.clientHeight * 0.25, scroller.scrollHeight - scroller.clientHeight))
  } catch {
    // The beat has gone from the page meanwhile: nothing to show.
  }
}

/** Reads the scene card's beats again (changed on the card while the session is on). */
export async function reloadBeats(sceneId: ID): Promise<void> {
  try {
    const beats = cardBeats((await api.getScene(sceneId)).card.beats)
    const s = useBeats.getState().session
    if (s?.sceneId === sceneId && beats.join('\n') !== s.beats.join('\n')) patchSession({ beats })
  } catch {
    // The bar keeps the beats it has.
  }
}

/** True when Adam changed the page himself (typing, pasting...) as a step of its own: not a beat's words, nor an undo or redo. */
function byAdam(tr: Transaction): boolean {
  const root = (tr.getMeta('appendedTransaction') as Transaction | undefined) ?? tr
  return tr.docChanged && !isHistoryTransaction(root) && !root.getMeta(streamKey) && root.getMeta('addToHistory') !== false
}

/** True when a change put other text in place of the whole scene at once (a picked variant, a restored snapshot...). */
function replacesAll(tr: Transaction): boolean {
  if (!tr.docChanged || isHistoryTransaction(tr) || tr.getMeta(streamKey) || tr.steps.length !== 1) return false
  const step = tr.steps[0]
  return step instanceof ReplaceStep && step.from === 0 && step.to === tr.before.content.size
}

/**
 * Follows the page while the bar shows: the beats on it are counted as it changes, and when the whole
 * scene is replaced at once and the beats go with it, the session is over. Returns the way to stop.
 */
export function watchPage(editor: Editor): () => void {
  let frame = 0
  const onUpdate = (): void => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      recount()
      settleHeight()
    })
  }
  const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
    // Adam changed the page himself while a beat is written: from here, redo only reaches his own changes.
    if (run && byAdam(transaction)) run.own = true
    const s = useBeats.getState().session
    if (!s || run || editorBridge()?.sceneId !== s.sceneId || !replacesAll(transaction)) return
    if (s.written > 0 && beatsOnPage(editor.state.doc, s.paragraphs) === 0) end()
  }
  // The page scrolled, or the window changed size: the pointer to a beat out of sight follows.
  let look = 0
  const onMove = (): void => {
    if (look) return
    look = requestAnimationFrame(() => {
      look = 0
      updatePointer()
    })
  }
  const scroller = scrollerOf(editor.view.dom)
  editor.on('update', onUpdate)
  editor.on('transaction', onTransaction)
  scroller?.addEventListener('scroll', onMove, { passive: true })
  window.addEventListener('resize', onMove)
  // Once the scene's page shows (the bar can show a frame before it does).
  frame = requestAnimationFrame(() => {
    frame = 0
    recount()
  })
  return () => {
    editor.off('update', onUpdate)
    editor.off('transaction', onTransaction)
    scroller?.removeEventListener('scroll', onMove)
    window.removeEventListener('resize', onMove)
    cancelAnimationFrame(frame)
    cancelAnimationFrame(look)
  }
}

// ---------- Where the page is ----------

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === 'auto' || y === 'scroll') return p
  }
  return null
}

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Scrolls smoothly (and quickly) to `to`, or in one step when the system asks for less motion. */
function glide(el: HTMLElement, to: number): void {
  const from = el.scrollTop
  const gap = to - from
  if (gap <= 1) return
  if (reducedMotion()) {
    el.scrollTop = to
    return
  }
  const start = performance.now()
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / 180)
    el.scrollTop = from + gap * (1 - Math.pow(1 - t, 3))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * A beat starting where Adam can see the end of the scene (above the bar, or behind it): the page glides
 * down as far as it goes, so the beat is written above the bar, and the page follows it as it grows (it
 * only follows from there: otherwise the words would go on under the bar). Reading further up, with the
 * end out of sight, the page stays where it is.
 */
function keepInView(): void {
  const ed = editorBridge()?.editor
  const scroller = ed ? scrollerOf(ed.view.dom) : null
  if (!ed || !scroller || !document.querySelector('[data-beat-bar]')) return
  let end: number
  try {
    end = ed.view.coordsAtPos(ed.state.doc.content.size).bottom
  } catch {
    return
  }
  if (end < scroller.getBoundingClientRect().bottom + 32) glide(scroller, scroller.scrollHeight - scroller.clientHeight)
}

/** Writing a beat again: the page's height while its old version goes and the new one comes. */
let held: { el: HTMLElement; px: number } | null = null

function holdHeight(el: HTMLElement): void {
  const px = Math.max(el.offsetHeight, held?.el === el ? held.px : 0)
  held = { el, px }
  el.style.minHeight = `${px}px`
}

/** Lets go of the held height as far as that can be done without moving what is on screen (the rest goes with the scene). */
export function settleHeight(): void {
  const h = held
  if (!h) return
  const scroller = scrollerOf(h.el)
  if (!scroller || !h.el.isConnected) return clearHeight()
  const top = scroller.scrollTop
  const below = Math.max(0, scroller.scrollHeight - scroller.clientHeight - top)
  h.el.style.minHeight = ''
  const spare = h.px - h.el.offsetHeight
  if (spare <= below) held = null
  else {
    h.px -= below
    h.el.style.minHeight = `${h.px}px`
  }
  scroller.scrollTop = top
}

/** Lets go of the held height (another scene is showing). */
export function clearHeight(): void {
  if (held) held.el.style.minHeight = ''
  held = null
}

// ---------- Events and keys ----------

let installed = false

/** Listens for the beats' words, Esc and Ctrl+Z, and what else happens in the app. Once, on first use. */
function install(): void {
  if (installed) return
  installed = true

  onEvent('generation:chunk', (p) => {
    const r = run
    if (!r || r.cancelled) return
    if (r.generationId === null) {
      if (p.sceneId === r.sceneId) r.early.push(p)
      return
    }
    if (p.generationId === r.generationId) append(r, p.text)
  })
  onEvent('generation:retrying', (p) => {
    const r = run
    if (r?.generationId && p.generationId === r.generationId) patchSession({ retrying: p.reason })
  })
  onEvent('generation:done', (p) => {
    const r = run
    if (!r) return
    if (r.generationId === null) {
      if (p.sceneId === r.sceneId) r.earlyDone = p
    } else if (p.generationId === r.generationId) finishBeat(r, p)
  })

  // Undo and redo while a beat is being written or getting ready: before the page's own keys (and the
  // bar's and Generate's below), so they never reach the beats before it (see undoMidBeat).
  window.addEventListener(
    'keydown',
    (e) => {
      const action = historyKeyOf(e)
      if (action && !e.defaultPrevented && reachesPage(e.target) && undoMidBeat(action)) swallow(e)
    },
    true
  )
  // The same from the Mac's Edit menu, which undoes in the page when it has the keyboard.
  window.addEventListener(
    'beforeinput',
    (e) => {
      const action = e.inputType === 'historyUndo' ? 'undo' : e.inputType === 'historyRedo' ? 'redo' : null
      if (action && inPage(e.target) && undoMidBeat(action)) swallow(e)
    },
    true
  )

  window.addEventListener('keydown', (e) => {
    const s = useBeats.getState().session
    const app = useApp.getState()
    // Only on the writing page with the session's scene open: elsewhere the keys belong to what shows.
    if (!s || app.view.kind !== 'write' || app.sceneId !== s.sceneId) return
    // The page takes Esc for itself (and marks it handled), but there it stops the beat too, as Stop says.
    const escape = e.key === 'Escape' && !e.isComposing && (s.phase === 'starting' || s.phase === 'writing')
    if (escape && (!e.defaultPrevented || inPage(e.target)) && !layerOpen()) {
      stopBeat()
      return
    }
    // Ctrl+Z in the bar (on its buttons, or in its box with nothing typed) undoes in the page: the last beat.
    const undoKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z'
    if (undoKey && !e.defaultPrevented && inBarNotTyping(e.target) && !layerOpen()) {
      if (editorBridge()?.sceneId === s.sceneId && editorBridge()?.undo()) e.preventDefault()
      return
    }
    // And redo (Ctrl+Y, or Ctrl+Shift+Z) brings it back, between beats.
    const redoKey = isShortcut(e, 'redo') || ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z')
    if (redoKey && s.phase === 'paused' && !e.defaultPrevented && inBarNotTyping(e.target) && !layerOpen()) {
      const ed = editorBridge()?.sceneId === s.sceneId ? editorBridge()?.editor : null
      if (ed && redo(ed.state, ed.view.dispatch)) e.preventDefault()
    }
  })

  useApp.subscribe((a, prev) => {
    const s = useBeats.getState().session
    if (!s) return
    if (a.world?.id !== s.worldId) return end()
    // Generate is writing a new draft of the scene: the session gives way to it.
    const g = a.activeGeneration
    if (g && g !== prev.activeGeneration && g.sceneId === s.sceneId && g.id !== run?.generationId) return end()
    // Another scene while a beat gets ready: it is called off (one being written is stopped by the editor).
    if (a.sceneId !== prev.sceneId && a.sceneId !== s.sceneId && run && !run.generationId) stopBeat()
  })
}
