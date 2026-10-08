// Reading aloud, from anywhere in the window: whether it is reading now, Listen (Ctrl+L) and Stop reading
// (Ctrl+Shift+Space), Listen from here, the bar's Back one line, Next line and speed, and what the bar above the
// page shows. Owned by the Read aloud part.
//
// A reading belongs to the scene it started in. Opening another scene, closing the world or turning read aloud
// off ends it; Keep reading carries it on into the next scene of the story by itself. The page it reads is the
// scene editor's (ReadAloudBar hands it over), whichever page of the app is showing.
import type { Editor } from '@tiptap/core'
import { create } from 'zustand'
import type { ID, SpeechSettings } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { openScene } from '@/features/memory/openScene'
import { mixer } from '@/features/sounds/mixer'
import { playRate } from './audio'
import { FollowAlong } from './follow'
import { barRoom, readingPlace } from './highlight'
import { sceneAfter } from './nextScene'
import { hasWords, pageParagraphs, placeOf, posIn, wordStart } from './pageText'
import { Session, type ReadingBar } from './session'
import { HOW_IT_READS } from './tone'
import { onSampleStart, stopSample } from './useSample'

export type { ReadingAt, ReadingBar, ReadingPhase } from './session'

interface ReadingState {
  /** A reading is under way (playing, paused, or getting its next lines ready). */
  reading: boolean
  paused: boolean
  /** The scene being read. */
  sceneId: ID | null
  /** What the bar above the page shows; null when it is closed. */
  bar: ReadingBar | null
}

export const useReading = create<ReadingState>(() => ({ reading: false, paused: false, sceneId: null, bar: null }))

let session: Session | null = null
/** The scene editor and its scrolling page, handed over by ReadAloudBar. */
let page: { editor: Editor; scroller: () => HTMLElement | null } | null = null
/** Keep reading opened this scene, and reading starts at its top once the page shows it. */
let carryOnInto: ID | null = null
let carryOnTimer: ReturnType<typeof setTimeout> | null = null
let finishedTimer: ReturnType<typeof setTimeout> | null = null

const readAloudOn = (): boolean => !!useApp.getState().settings?.speech.readAloud

function setBar(bar: ReadingBar | null): void {
  if (finishedTimer) clearTimeout(finishedTimer)
  finishedTimer = null
  const live = !!session?.active
  useReading.setState({
    bar,
    reading: live,
    paused: live && !!session?.isPaused,
    sceneId: live ? session!.sceneId : useReading.getState().sceneId
  })
  // "Read to the end" fades away by itself after a moment.
  if (bar?.phase === 'finished') finishedTimer = setTimeout(() => closeReading(), 5000)
}

/**
 * Starts reading a scene from a place on its page (a new reading: the first clip is one sentence). `note`: what the
 * bar says until the first line plays, when not the usual "Getting the first lines ready…".
 */
function begin(editor: Editor, sceneId: ID, pos: number, note?: string): void {
  stopSample()
  if (session?.active) session.stop(false)
  clearCarryOn()
  const s = new Session(editor, sceneId, page?.scroller ?? (() => null), {
    bar: (bar) => {
      if (session === s) setBar(bar)
    },
    end: () => {
      if (session === s) void carryOn(s)
    }
  })
  session = s
  useReading.setState({ sceneId })
  void s.start(pos, true, note)
}

/** The page shown now, when it is showing the scene the app has open. */
function openPage(): { editor: Editor; sceneId: ID } | null {
  const bridge = editorBridge()
  const editor = bridge?.editor ?? page?.editor ?? null
  const sceneId = bridge?.sceneId ?? null
  if (!editor || editor.isDestroyed || !sceneId || sceneId !== useApp.getState().sceneId) return null
  return { editor, sceneId }
}

/** Reading from the paragraph at the cursor (or the last one with words before it). */
function startFromCursor(): void {
  if (!readAloudOn()) return
  const open = openPage()
  if (!open) return
  const paragraphs = pageParagraphs(open.editor.state.doc)
  const at = placeOf(paragraphs, open.editor.state.selection.from)
  let i = at ? at.index : paragraphs.length - 1
  while (i >= 0 && !hasWords(paragraphs[i])) i--
  if (i < 0) {
    // Past the words (an empty line at the end): the first paragraph with words after the cursor, if any.
    i = paragraphs.findIndex((p, k) => k > (at?.index ?? -1) && hasWords(p))
  }
  if (i < 0) {
    toast('There are no words in this scene to read yet.')
    return
  }
  begin(open.editor, open.sceneId, posIn(paragraphs[i], 0))
}

/** Listen (the headphones button, Ctrl+L): reads from the cursor, or pauses or carries on with a reading under way. */
export function toggleListen(): void {
  if (session?.active) {
    if (session.isPaused) session.resume()
    else session.pause()
    return
  }
  startFromCursor()
}

/** Listen from here: reads from the start of the selected words (from the start of a word selected only in part). */
export function listenFrom(editor: Editor, sceneId: ID, from: number): void {
  if (!readAloudOn() || editor.isDestroyed) return
  const paragraphs = pageParagraphs(editor.state.doc)
  const at = placeOf(paragraphs, from)
  begin(editor, sceneId, at ? posIn(paragraphs[at.index], wordStart(paragraphs[at.index].text, at.offset)) : from)
}

export function pauseReading(): void {
  session?.pause()
}

export function resumeReading(): void {
  session?.resume()
}

/** Back one line: the line before the one playing is read again, and reading goes on from there. */
export function stepBack(): void {
  session?.back()
}

/** Next line: on to the line after the one playing. */
export function stepNext(): void {
  session?.next()
}

/** Redo this line: the line playing is voiced again as another take, kept for it from now on. */
export function redoLine(): void {
  void session?.redo()
}

/** The bar's speeds. Settings' slider can set any speed from 0.5× to 2×, which the bar shows as it is. */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

/** "1×", "1.25×". */
export const speedText = (speed: number): string => `${Number(speed.toFixed(2))}×`

/** Saves read-aloud settings from the bar, saying so in plain words when that can't be done. */
export function saveSpeech(patch: Partial<SpeechSettings>): void {
  useApp
    .getState()
    .updateSettings({ speech: patch })
    .catch((e: unknown) => toast(`That change couldn't be saved. ${(e as Error).message}`, { tone: 'danger' }))
}

/** A speed from the bar: heard at once, and saved as the read-aloud speed (Settings › Read aloud and dictation). */
export function setSpeed(speed: number): void {
  session?.setRate(playRate(speed))
  saveSpeech({ speed })
}

/** Sound effects: the scene's sounds changed for the whole reading (muted, or back on): its next lines are planned again. */
export function replanReading(): void {
  session?.settingsChanged()
}

/** Stops reading, from anywhere (Ctrl+Shift+Space). The bar stays, so it can carry on from there. */
export function stopReading(): void {
  stopSample()
  clearCarryOn()
  if (!session?.active) {
    // Keep reading was opening the next scene: that ends too.
    if (useReading.getState().bar?.phase === 'starting') setBar({ phase: 'stopped', who: '', how: '', note: 'Stopped.', fix: null })
    // Sound effects: an ambience kept for the next scene goes too.
    mixer.stop()
    return
  }
  session.stop(true, { phase: 'stopped', note: 'Stopped.', fix: null })
}

/** Close: stops reading and the bar goes. */
export function closeReading(): void {
  clearCarryOn()
  session?.stop(false)
  session = null
  // Sound effects: an ambience kept for the next scene goes too.
  mixer.stop()
  setBar(null)
  useReading.setState({ sceneId: null })
}

/** Where the reading that ended was, when the page shows its scene still. */
function lastPlace(): { editor: Editor; sceneId: ID; from: number; to: number } | null {
  const open = openPage()
  const s = session
  if (!open || !s || s.sceneId !== open.sceneId || s.editor !== open.editor) return null
  const place = readingPlace(open.editor.state).clip
  return place ? { ...open, ...place } : null
}

/**
 * After Stop, a problem, or the end: reads again, from the line it stopped at (or the cursor). Stop repeats the line
 * it cut off, and a problem tries the line that failed (or carries on from where reading got to).
 */
export function listenAgain(): void {
  const at = lastPlace()
  if (!at || useReading.getState().bar?.phase === 'finished') return startFromCursor()
  begin(at.editor, at.sceneId, at.from)
}

/** After a line the voice couldn't read: reading carries on from the line after it. */
export function skipLine(): void {
  const at = lastPlace()
  if (!at) return startFromCursor()
  begin(at.editor, at.sceneId, at.to)
}

/**
 * The chapter and scene named in the bar: opens the scene being read (from whichever page is showing) and brings the
 * line being read into view, a third of the way down the page.
 */
export function showReading(): void {
  const { sceneId } = useReading.getState()
  if (!sceneId) return
  const app = useApp.getState()
  if (app.sceneId !== sceneId || app.view.kind !== 'write') void openScene(sceneId)
  // Once the page is on screen.
  requestAnimationFrame(() => {
    const p = page
    if (!p || p.editor.isDestroyed || editorBridge()?.sceneId !== sceneId) return
    const place = readingPlace(p.editor.state)
    const pos = place.sentence?.from ?? place.clip?.from
    if (pos == null) return
    try {
      new FollowAlong(p.scroller, barRoom).bring(p.editor.view.coordsAtPos(pos).top)
    } catch {
      // Not on the page any more: nothing to bring into view.
    }
  })
}

/** A part of Settings › Read aloud and dictation to show when it opens (its element's id), under More. */
let reveal: string | null = null

/** The id of a part of the speech settings asked for when they were opened, once. */
export function takeSettingsReveal(): string | null {
  const id = reveal
  reveal = null
  return id
}

/** Settings › Read aloud and dictation, where the speech engine is set up. */
export function openSpeechSettings(): void {
  reveal = null
  useApp.getState().navigate({ kind: 'settings', tab: 'speech' })
}

/** Settings › Read aloud and dictation open at How it reads (More opens, and the page scrolls to it). */
export function openHowItReads(): void {
  reveal = HOW_IT_READS
  useApp.getState().navigate({ kind: 'settings', tab: 'speech' })
}

// ---------- Keep reading ----------

function clearCarryOn(): void {
  carryOnInto = null
  if (carryOnTimer) clearTimeout(carryOnTimer)
  carryOnTimer = null
}

const finished = (note: string): void => {
  // Sound effects: no scene to carry on into, so the ambience fades out.
  mixer.endBed()
  setBar({ phase: 'finished', who: '', how: '', note, fix: null })
}

/** The scene's words have all been read: on into the next scene (Keep reading), or the bar says it is done. */
async function carryOn(s: Session): Promise<void> {
  const { settings, storyId } = useApp.getState()
  if (!settings?.speech.keepReading || !storyId) return finished('Read to the end of the scene.')
  let next: ReturnType<typeof sceneAfter> = null
  try {
    next = sceneAfter(await api.getOutline(storyId), s.sceneId)
  } catch {
    return finished('Read to the end of the scene.')
  }
  // Adam started something else meanwhile.
  if (session !== s || useApp.getState().sceneId !== s.sceneId) return
  if (!next) return finished('Read to the end of the story.')
  carryOnInto = next.id
  // The bar and the binder name the scene it is going on to from now.
  useReading.setState({ sceneId: next.id })
  setBar({ phase: 'starting', who: '', how: '', note: `On to “${next.title || 'Untitled scene'}”…`, fix: null })
  // Opening the scene keeps whatever page Adam is on (the writing view stays behind it).
  if (useApp.getState().view.kind === 'write') useApp.getState().selectScene(next.id)
  else {
    useApp.setState({ sceneId: next.id })
    void api.updateSettings({ lastSceneId: next.id }).catch(() => undefined)
  }
  carryOnTimer = setTimeout(() => {
    if (!carryOnInto) return
    clearCarryOn()
    finished('The next scene didn’t open, so reading stopped.')
  }, 15_000)
}

// ---------- The page, and what ends a reading ----------

/** ReadAloudBar hands over the scene editor and its page. */
export function attachPage(editor: Editor, scroller: () => HTMLElement | null): () => void {
  page = { editor, scroller }
  watch()
  return () => {
    if (page?.editor !== editor) return
    page = null
    closeReading()
  }
}

/** The page now shows a scene: a reading carried on by Keep reading starts at its top. */
export function sceneShown(sceneId: ID | null): void {
  if (!sceneId || sceneId !== carryOnInto || !page) return
  // The page says which scene it shows just before it swaps in that scene's words: start once they are there.
  setTimeout(() => {
    if (sceneId !== carryOnInto || !page || page.editor.isDestroyed) return
    clearCarryOn()
    const first = pageParagraphs(page.editor.state.doc).find((p) => hasWords(p))
    if (!first) return finished('Read to the end of the scene.')
    // The bar keeps saying where it is going ("On to “Morning”…") until the first line plays.
    begin(page.editor, sceneId, posIn(first, 0), useReading.getState().bar?.note || undefined)
  }, 0)
}

let watching = false
function watch(): void {
  if (watching) return
  watching = true
  // A sample pauses a reading, so the two never talk over each other.
  onSampleStart(() => {
    if (session?.active && !session.isPaused) session.pause()
  })
  useApp.subscribe((now, before) => {
    const reading = useReading.getState()
    // Another scene opened (not by Keep reading), the world closed, or read aloud was turned off: the reading ends.
    const sceneChanged = now.sceneId !== before.sceneId && now.sceneId !== carryOnInto && reading.sceneId && now.sceneId !== reading.sceneId
    if (sceneChanged || now.world?.id !== before.world?.id || (!now.settings?.speech.readAloud && before.settings?.speech.readAloud)) {
      if (reading.bar || session) closeReading()
      stopSample()
      return
    }
    const speech = now.settings?.speech
    const was = before.settings?.speech
    if (speech?.speed !== was?.speed) session?.setRate(playRate(speech?.speed))
    // Sound effects turned off: any sound goes now, even an ambience kept for Keep reading's next scene.
    if (!speech?.soundEffects && was?.soundEffects) mixer.stop()
    // How the lines are read changed: the next lines are planned again with it.
    if (
      speech &&
      was &&
      (speech.markSpeakers !== was.markSpeakers ||
        speech.sounds !== was.sounds ||
        speech.steadyNarrator !== was.steadyNarrator ||
        speech.voicedLines !== was.voicedLines ||
        speech.soundEffects !== was.soundEffects)
    )
      session?.settingsChanged()
  })
}
