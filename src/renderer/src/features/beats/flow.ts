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
import type { Transaction } from '@tiptap/pm/state'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { AppEvents } from '@shared/api'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError, modKey, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { activeStream, streamKey } from '@/features/editor/streamDoc'
import { resolveDraftOptions } from '@/features/generate/draftOptions'
import { snapshotBefore } from '@/features/history/snapshot'
import { revealCardPart } from '@/features/palette/cardReveal'
import { focusBar, patchSession, useBeats, type BeatQuestion } from './session'
import {
  beatsOnPage,
  cardBeats,
  isWholePage,
  nextBeat,
  pidsFrom,
  removeParagraphs,
  soFarText,
  withParagraphs,
  type BeatMode
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
  /** Writing again: the paragraphs of the beat as it was, taken out as the new words arrive. */
  old: string[]
  removed: boolean
  generationId: ID | null
  /** Words that arrived before startBeat returned the beat's id. */
  early: AppEvents['generation:chunk'][]
  earlyDone: AppEvents['generation:done'] | null
  cancelled: boolean
  /** Some of the beat's words reached the page. */
  wrote: boolean
}

let run: Run | null = null

/** Sessions whose scene has been kept in its History before their first beat went in. */
const kept = new Set<ID>()

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
      written: 0,
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

/** Write it again: the beat just written is written afresh in its place, with the note in the box. */
export function writeAgain(): void {
  const s = useBeats.getState().session
  if (!s || s.phase !== 'paused' || run || s.written < 1) return
  void writeBeat(s.written, { again: true })
  focusBar()
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
  // Writing again a beat that is all there is on the page: the new one takes the page's place, as Replace it does.
  const replace = !!how.replace || (again && isWholePage(doc, old))
  const steer = s.steer.trim()
  const soFar = index > 1 ? soFarText(doc, s.mode, s.paragraphs, again ? index : undefined) : ''
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
    old,
    removed: false,
    generationId: null,
    early: [],
    earlyDone: null,
    cancelled: false,
    wrote: false
  }
  run = r
  // The note goes with this beat; the box is ready for the next one.
  patchSession({ phase: 'starting', current: { index, generationId: null, again, steer }, steer: '', retrying: null })
  /** The beat didn't start: the page is as it was, and the note goes back in the box (unless a new one was typed meanwhile). */
  const giveUp = (): void => {
    if (run !== r) return
    run = null
    if (replace) bridge.releaseHold()
    patchSession((x) => ({ phase: 'paused', current: null, retrying: null, steer: x.steer.trim() ? x.steer : steer }))
  }
  try {
    // The scene as it was before the session's first beat went in, kept in its History.
    if (!kept.has(s.id) && bridge.hasText()) {
      kept.add(s.id)
      await snapshotBefore(s.sceneId, 'Before beat by beat')
    }
    // The card and the page are saved first, so the beat is written from the latest of both.
    await flushAll()
    const card = (await api.getScene(s.sceneId)).card
    const app = useApp.getState()
    const options = resolveDraftOptions(app.draftOptions[s.sceneId], card.targetWords, app.settings?.creativity ?? 'balanced')
    if (r.cancelled) return giveUp()
    const { generationId, of } = await api.startBeat({ sceneId: s.sceneId, sessionId: s.id, index, options, steer, soFar })
    if (r.cancelled || run !== r) {
      void api.stopGeneration(generationId).catch(() => undefined)
      giveUp()
      return
    }
    // Every beat after the first carries straight on, so the beats read as one piece.
    if (!bridge.beginStream(s.sceneId, generationId, { replace, noBreak: !replace && (index > 1 || again) })) {
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
  } catch (e) {
    const cancelled = r.cancelled
    giveUp()
    if (!cancelled) failedToStart(e as ApiError, s.sceneId)
  }
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
  // Writing again: the beat as it was goes as the new words arrive, in a step of its own (Ctrl+Z puts it
  // back). The page keeps its height meanwhile, so nothing on screen moves.
  if (r.old.length && !r.removed && !r.replace && text.trim()) {
    r.removed = true
    const tr = removeParagraphs(ed.state, r.old)
    if (tr) {
      holdHeight(ed.view.dom)
      ed.view.dispatch(tr)
      // Anything typed straight after is a step of its own.
      ed.view.dispatch(closeHistory(ed.state.tr))
    }
  }
  bridge.appendStream(r.generationId, text)
  note(r)
  if (useBeats.getState().session?.retrying) patchSession({ retrying: null })
}

/** Remembers the paragraphs the beat has written so far (so the page says how far the session has got). */
function note(r: Run): void {
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!ed || bridge?.sceneId !== r.sceneId) return
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
  if (paragraphs !== s.paragraphs) patchSession({ paragraphs })
}

/** The beat has ended: the bar pauses for Adam's note, and a problem is said in one message (as for Generate). */
function finishBeat(r: Run, p: AppEvents['generation:done']): void {
  if (run !== r) return
  note(r)
  const failed = (p.status === 'error' && !!p.error) || !!p.cutOff
  // A beat written again in the page's place says nothing of its own: the bar and the page show it.
  const { replaced } = editorBridge()?.endStream(p.generationId, { failed: failed || r.again }) ?? { replaced: false }
  run = null
  const app = useApp.getState()
  if (app.activeGeneration?.id === p.generationId) app.setActiveGeneration(null)
  // A beat that brought no words: the note goes back in the box, unless a new one has been typed.
  patchSession((x) => ({
    phase: 'paused',
    current: null,
    retrying: null,
    steer: !r.wrote && !x.steer.trim() && x.current ? x.current.steer : x.steer
  }))
  recount()
  settleHeight()
  const showRecord = {
    label: 'What the AI saw',
    run: () => useApp.getState().navigate({ kind: 'generation', generationId: p.generationId })
  }
  const back = r.again
    ? replaced
      ? ` ${modKey()}+Z puts the beat back as it was.`
      : r.removed
        ? ` ${modKey()}+Z takes the new words out, and pressed again puts the beat back as it was.`
        : ''
    : replaced
      ? ` ${modKey()}+Z puts the scene's old text back.`
      : ''
  if (p.status === 'error' && p.error) {
    toast(p.error + back, {
      tone: 'danger',
      action: /\bSettings\b/.test(p.error) ? { label: 'Open Settings', run: openSettings } : showRecord
    })
  } else if (p.cutOff) {
    toast(
      `The model ran out of room before the end of the beat, so it stops mid-way. The text so far is kept. Write it again, or try a writer model that can write more in one go.${back}`,
      { action: showRecord }
    )
  }
  // Ready for the next note, if the keyboard was in the bar (or nowhere in particular).
  const here = document.activeElement
  if (!here || here === document.body || here.closest('[data-beat-bar]')) focusBar()
}

// ---------- Following the page ----------

/** Works out how many beats are on the page (after Ctrl+Z, redo, edits...). */
export function recount(): void {
  const s = useBeats.getState().session
  const bridge = editorBridge()
  const ed = bridge?.editor
  if (!s || !ed || bridge?.sceneId !== s.sceneId) return
  const written = beatsOnPage(ed.state.doc, s.paragraphs)
  if (written !== s.written) patchSession({ written })
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
    const s = useBeats.getState().session
    if (!s || run || editorBridge()?.sceneId !== s.sceneId || !replacesAll(transaction)) return
    if (s.written > 0 && beatsOnPage(editor.state.doc, s.paragraphs) === 0) end()
  }
  editor.on('update', onUpdate)
  editor.on('transaction', onTransaction)
  // Once the scene's page shows (the bar can show a frame before it does).
  frame = requestAnimationFrame(() => {
    frame = 0
    recount()
  })
  return () => {
    editor.off('update', onUpdate)
    editor.off('transaction', onTransaction)
    cancelAnimationFrame(frame)
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
 * A beat starting where Adam is reading the end of the scene, behind the bar: the page glides down to
 * the end, so the beat is written above the bar, and the page follows it as it grows. Reading further
 * up, the page stays where it is.
 */
function keepInView(): void {
  const ed = editorBridge()?.editor
  const bar = document.querySelector('[data-beat-bar]')
  const scroller = ed ? scrollerOf(ed.view.dom) : null
  if (!ed || !bar || !scroller) return
  let end: number
  try {
    end = ed.view.coordsAtPos(ed.state.doc.content.size).bottom
  } catch {
    return
  }
  const barTop = bar.getBoundingClientRect().top
  const bottom = scroller.getBoundingClientRect().bottom
  if (end > barTop - 12 && end < bottom + 32) glide(scroller, scroller.scrollHeight - scroller.clientHeight)
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
