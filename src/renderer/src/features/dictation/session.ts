// Dictation's recordings (milestone 4): one listens at a time, from the hold-to-talk key, a microphone
// button or the microphone Test in Settings. A recording starts a little before it was asked for (the
// words said as the key goes down), stops when asked, when the window goes to the back, or at about four
// minutes, and is written down by the speech engine through the main process. Its words are handed over
// in the order the recordings were made. Problems are plain words with the next step, and the audio is
// kept only in memory: never written anywhere.
//
// The microphone is open only while the window is in front and dictation is on: a key picked and the
// speech engine ready (so the moment before the key goes down is there to keep), or a recording going.
import { create } from 'zustand'
import { DICTATION_MAX_SECONDS, DICTATION_SAMPLE_RATE } from '@shared/contracts/dictation'
import { toast } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import {
  closeMic,
  dropTake,
  finishTake,
  MicError,
  MIC_BUSY,
  micFellBack,
  micIsOpen,
  onMicBatch,
  onMicEnded,
  openMic,
  openMicId,
  startTake,
  takeSeconds,
  type Take
} from './mic'
import type { Anchor } from './place'
import { encodeWav, leadIn, peakOf } from './wav'

const RATE = DICTATION_SAMPLE_RATE

/** Shorter than this (a tap of the key, a double click) is nothing to write down. */
const SHORTEST_SECONDS = 0.3
/** The last words are still on their way from the microphone as the key comes up. */
const TAIL_MS = 250
/** Quieter than this all through is a microphone that heard nothing (muted, or the wrong one). */
const QUIET_PEAK = 0.003
/** The countdown shows for the last stretch before the limit. */
const COUNTDOWN_SECONDS = 20

export type Owner = 'key' | 'button' | 'test'
export type Phase = 'starting' | 'listening' | 'writing'

/** A recording as the screen shows it. */
export interface Recording {
  id: number
  owner: Owner
  /** Which microphone button (or 'key', 'test') it belongs to, so each shows only its own. */
  by: string
  /** 'starting': the microphone is being opened; 'listening'; 'writing': being written down. */
  phase: Phase
  /** Not shown yet: a Ctrl, Shift or Alt key went down, and it may still turn out to be a shortcut. */
  hidden: boolean
  /** Seconds left before the limit, in the last stretch; null before that. */
  left: number | null
  /** Where its marker goes, worked out as it shows (the cursor or the box can move). */
  anchor: (() => Anchor | null) | null
}

export const useDictation = create<{ recordings: Recording[] }>(() => ({ recordings: [] }))

export interface StartOptions {
  owner: Owner
  by?: string
  /** How far back to start, in seconds: the words said as the key went down. */
  preRoll?: number
  hidden?: boolean
  anchor?: (() => Anchor | null) | null
  /** Gets the words (tidied, never empty), in the order the recordings were made. */
  deliver: (text: string) => void
  /** A problem in plain words: the Test shows it itself; otherwise it is a message in the corner. */
  onProblem?: (message: string, code?: string) => void
  /** Nothing came of it: too short, or no words were heard ('quiet': the microphone heard nothing at all). */
  onNothing?: (why: 'short' | 'quiet' | 'no-words') => void
  /** The microphone picked isn't plugged in, so the computer's default is listening. */
  onFellBack?: () => void
}

interface Job {
  id: number
  o: StartOptions
  take: Take | null
  startedAt: number
  /** Asked to stop (or stopped by the window going to the back, or the limit). */
  stopping: boolean
  /** Its sound has been taken from the microphone (or it ended without any). */
  taken: boolean
}

const jobs = new Map<number, Job>()
let seq = 0
/** Words are handed over in the order the recordings were made: each waits for the one before. */
let inOrder: Promise<void> = Promise.resolve()
/** Dictation is on for the key: a key picked and the speech engine ready. */
let keyOn = false

function patch(id: number, change: Partial<Recording>): void {
  useDictation.setState((s) => ({ recordings: s.recordings.map((r) => (r.id === id ? { ...r, ...change } : r)) }))
}

function remove(id: number): void {
  jobs.delete(id)
  useDictation.setState((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) }))
  syncMic()
}

/** The microphone picked in Settings ('' for the computer's default). */
const microphone = (): string => useApp.getState().settings?.speech?.microphone ?? ''

/** The window is in front. */
const inFront = (): boolean => typeof document !== 'undefined' && document.hasFocus()

/** A recording still needs the microphone: it hasn't been taken yet. */
const needsMic = (): boolean => [...jobs.values()].some((j) => !j.taken)

/** Opens or closes the microphone to match what dictation needs now. */
export function syncMic(): void {
  const needed = needsMic()
  if (!needed && !(keyOn && inFront())) {
    closeMic()
    return
  }
  const device = microphone()
  if (micIsOpen() && (openMicId() === device || needed)) return
  // Problems opening it are said when Adam dictates, not while it is being kept ready.
  openMic(device).catch(() => undefined)
}

/** Dictation is on for the hold-to-talk key (a key picked and the speech engine ready), or off. */
export function setKeyDictation(on: boolean): void {
  keyOn = on
  installWatchers()
  syncMic()
}

let picking = false

/** Settings is waiting for Adam to press the key he wants: holding the old one doesn't dictate meanwhile. */
export function setPickingKey(on: boolean): void {
  picking = on
}

export const pickingKey = (): boolean => picking

/** The recording listening now (or starting), if any: only one listens at a time. */
export const listeningNow = (): Recording | undefined => useDictation.getState().recordings.find((r) => r.phase !== 'writing')

/** Starts a recording. Null when another one is already listening. */
export function startRecording(o: StartOptions): number | null {
  installWatchers()
  if ([...jobs.values()].some((j) => !j.stopping)) return null
  const id = ++seq
  const job: Job = { id, o, take: null, startedAt: performance.now(), stopping: false, taken: false }
  jobs.set(id, job)
  const rec: Recording = {
    id,
    owner: o.owner,
    by: o.by ?? o.owner,
    phase: 'starting',
    hidden: !!o.hidden,
    left: null,
    anchor: o.anchor ?? null
  }
  useDictation.setState((s) => ({ recordings: [...s.recordings, rec] }))
  const listen = (): void => {
    job.take = startTake(o.preRoll ?? 0)
    patch(id, { phase: 'listening' })
    if (micFellBack()) o.onFellBack?.()
  }
  const device = microphone()
  if (micIsOpen() && openMicId() === device) {
    listen()
    return id
  }
  openMic(device).then(
    () => {
      if (!jobs.has(id)) return
      if (job.stopping) {
        // Let go before the microphone was listening: nothing was recorded.
        job.taken = true
        remove(id)
        o.onNothing?.('short')
        return
      }
      listen()
    },
    (e: unknown) => {
      if (!jobs.has(id)) return
      job.taken = true
      remove(id)
      // The window went to the back while it was opening: nothing to say.
      if (e instanceof MicError && e.kind === 'closed') return
      problem(o, e instanceof MicError ? e.message : MIC_BUSY, 'microphone')
    }
  )
  return id
}

/** Shows a recording's marker (it was hidden while it might have been a shortcut). */
export function revealRecording(id: number): void {
  if (jobs.has(id)) patch(id, { hidden: false })
}

/** Stops a recording and writes down what was said. */
export function finishRecording(id: number): void {
  const job = jobs.get(id)
  if (!job || job.stopping) return
  job.stopping = true
  // Still starting: nothing has been recorded yet, so it is let go once the microphone answers.
  if (job.take) void take(job)
}

/** Stops a recording and lets go of what it heard, without writing it down. */
export function cancelRecording(id: number): void {
  const job = jobs.get(id)
  if (!job) return
  if (job.take && !job.taken) dropTake(job.take)
  job.taken = true
  remove(id)
}

/** Takes the recording's sound from the microphone and sends it to be written down. */
async function take(job: Job): Promise<void> {
  if (!job.take || job.taken) return
  const held = (performance.now() - job.startedAt) / 1000
  if (held < SHORTEST_SECONDS) {
    dropTake(job.take)
    job.taken = true
    remove(job.id)
    job.o.onNothing?.('short')
    return
  }
  patch(job.id, { phase: 'writing', hidden: false, left: null })
  const samples = await finishTake(job.take, TAIL_MS)
  job.taken = true
  syncMic()
  if (peakOf(samples) < QUIET_PEAK) {
    remove(job.id)
    nothing(job.o, held > 1 ? 'quiet' : 'short')
    return
  }
  writeDown(job.id, job.o, encodeWav(leadIn(samples, RATE), RATE))
}

/** Sends a recording to the speech engine, and hands its words over in turn. */
function writeDown(id: number, o: StartOptions, wav: Uint8Array): void {
  const words = api.transcribeDictation(wav).then((r) => r.text.trim())
  // Keep the order even when a later recording is written down first; a problem never holds up the rest.
  words.catch(() => undefined)
  inOrder = inOrder.then(async () => {
    try {
      const text = await words
      remove(id)
      if (text) o.deliver(text)
      else nothing(o, 'no-words')
    } catch (e) {
      remove(id)
      const err = e instanceof ApiError ? e : null
      const retry = err?.code === 'dictation-too-long' ? undefined : (): void => again(o, wav)
      problem(o, err?.message ?? "Your words couldn't be written down. Try again.", err?.code, retry)
    }
  })
}

/** Tries writing the same recording down again (after "Try again"), in turn with any others. */
function again(o: StartOptions, wav: Uint8Array): void {
  const id = ++seq
  jobs.set(id, { id, o, take: null, startedAt: performance.now(), stopping: true, taken: true })
  const rec: Recording = { id, owner: o.owner, by: o.by ?? o.owner, phase: 'writing', hidden: false, left: null, anchor: o.anchor ?? null }
  useDictation.setState((s) => ({ recordings: [...s.recordings, rec] }))
  writeDown(id, o, wav)
}

/** Opens Settings › Read aloud and dictation. */
export const openSpeechSettings = (): void => useApp.getState().navigate({ kind: 'settings', tab: 'speech' })

/** Codes whose fix is in Settings › Read aloud and dictation. */
const FIX_IN_SETTINGS = new Set(['speech-not-running', 'dictation-not-ready', 'microphone'])

function problem(o: StartOptions, message: string, code?: string, retry?: () => void): void {
  if (o.onProblem) return o.onProblem(message, code)
  // One button, so the message has room to be read: Try again when there are words to try again (the
  // message says where the fix is), else Settings when the fix is there.
  const settings = !!code && FIX_IN_SETTINGS.has(code) && useApp.getState().view.kind !== 'settings'
  toast(message, {
    tone: 'danger',
    action: retry ? { label: 'Try again', run: retry } : settings ? { label: 'Open Settings', run: openSpeechSettings } : undefined
  })
}

export const NOTHING_HEARD =
  "The microphone didn't hear anything. Check it's the right one and not muted: Test in Settings › Read aloud and dictation shows what it hears."
export const NO_WORDS = 'No words were heard that time, so nothing was typed.'

function nothing(o: StartOptions, why: 'short' | 'quiet' | 'no-words'): void {
  if (o.onNothing) return o.onNothing(why)
  if (why === 'quiet')
    toast(NOTHING_HEARD, {
      secondary: useApp.getState().view.kind !== 'settings' ? { label: 'Open Settings', run: openSpeechSettings } : undefined
    })
  else if (why === 'no-words') toast(NO_WORDS)
}

/** Plain words for reaching the limit: what happens, and how to carry on. */
export function limitMessage(owner: Owner): string {
  const minutes = Math.round(DICTATION_MAX_SECONDS / 60)
  const carryOn = owner === 'key' ? 'let go of the key and hold it again' : 'start again'
  return `A recording can run to about ${minutes} minutes, so this one stopped there and what you said is being written down. To say more, ${carryOn}.`
}

let watching = false

/** Watches the window and the microphone, once: what to do when the window goes to the back, and at the limit. */
function installWatchers(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  // Switching to another window stops and writes down what was said, so a recording never gets stuck;
  // the microphone is let go until the window is in front again.
  window.addEventListener('blur', () => {
    for (const job of jobs.values()) if (!job.stopping) finishRecording(job.id)
    closeMic()
  })
  window.addEventListener('focus', () => syncMic())
  // Another microphone picked in Settings.
  useApp.subscribe((s, prev) => {
    if (s.settings?.speech?.microphone !== prev.settings?.speech?.microphone) syncMic()
  })
  onMicBatch(() => {
    for (const job of jobs.values()) {
      if (!job.take || job.stopping) continue
      const seconds = takeSeconds(job.take)
      const left = Math.max(0, Math.ceil(DICTATION_MAX_SECONDS - seconds))
      if (left <= COUNTDOWN_SECONDS && useDictation.getState().recordings.find((r) => r.id === job.id)?.left !== left)
        patch(job.id, { left })
      if (seconds >= DICTATION_MAX_SECONDS) {
        finishRecording(job.id)
        if (job.o.onProblem) job.o.onProblem(limitMessage(job.o.owner), 'limit')
        else toast(limitMessage(job.o.owner))
      }
    }
  })
  // The microphone stopped by itself (unplugged): what was said up to then is written down.
  onMicEnded(() => {
    const stopped = [...jobs.values()].filter((j) => !j.stopping)
    for (const job of stopped) finishRecording(job.id)
    if (stopped.length)
      toast('The microphone stopped (was it unplugged?), so listening stopped. What you said up to then is being written down.')
  })
}
